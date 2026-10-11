"""Coordinate observation sources, incident persistence and operator state."""
import threading
import time
import uuid
from pathlib import Path
from .delivery import from_environment
from .detector import Detector, Observation, regions_overlap
from .store import utc_now
from .sources import CameraFeed, synthetic_observations

ROOT = Path(__file__).resolve().parents[1]
CONSENT_TEXT = ('I confirm everyone in view has been told this camera is monitored locally, '
                'and I have their consent to run person detection.')


class Runtime:
    def __init__(self, store, source, camera_id, zone_id, video_input=0):
        self.store, self.source = store, source
        self.camera_id, self.zone_id = camera_id, zone_id
        self.video_input = video_input
        self.run_id, self.sequence = str(uuid.uuid4()), 0
        self.detector = Detector(ratio_threshold=1.0, min_duration=2.0, require_upright=False, duration_exclusive=True)
        self.lock, self.stop = threading.RLock(), threading.Event()
        if source == 'synthetic':
            self.status, self.message = 'starting', None
        else:
            # Never open a camera/video at launch: wait for dashboard consent.
            self.status, self.message = 'awaiting_consent', 'Camera off. Confirm consent in the dashboard to start.'
        self.scenario = 'upright'
        self.tracks, self.frame_size = [], [640, 360]
        self.scenario_revision = 0
        self.preview_jpeg = None
        self.camera_stop = threading.Event()
        self.camera_thread = None
        self.camera_active = False
        self.consent_at = None
        self.suppressed_repeats = 0
        self.delivery = from_environment(store)

    def frame(self, observations, timestamp, frame_size):
        with self.lock:
            observed_at = utc_now()
            batch = tuple(observations)
            previous_count = self.detector.suppressed
            candidates = self.detector.update(batch, timestamp, frame_size)
            self.suppressed_repeats += self.detector.suppressed - previous_count
            self.tracks = []
            for sample in batch:
                if sample.bbox[2] <= sample.bbox[0]:
                    continue
                pose = self.detector.classify(sample, frame_size)
                self.tracks.append(dict(trackId=sample.track_id, bbox=sample.bbox,
                                        state=pose, horizontal=pose == 'horizontal'))
            self.frame_size = frame_size
            occupied = self.store.unresolved_regions(self.camera_id) if candidates else []
            for candidate in candidates:
                footprint = candidate['evidence']['region']
                already_open = any(regions_overlap(footprint, region, self.detector.region_iou,
                                                   self.detector.region_centroid) for region in occupied)
                if already_open:
                    self.suppressed_repeats += 1
                else:
                    self.sequence += 1
                    self.store.record(candidate, self.source, self.run_id, self.sequence, self.camera_id, self.zone_id, observed_at=observed_at)
                    occupied.append(footprint)

    def state(self):
        with self.lock:
            return {'source': self.source, 'status': self.status, 'message': self.message,
                    'cameraActive': self.camera_active, 'consentAt': self.consent_at,
                    'consentText': None if self.source == 'synthetic' else CONSENT_TEXT,
                    'suppressedRepeats': self.suppressed_repeats,
                    'tracks': self.tracks, 'frameSize': self.frame_size,
                    'incidents': self.store.review_queue(),
                    'delivery': {'configured': bool(self.delivery), 'pending': len(self.store.pending()),
                                 'error': self.delivery.last_error if self.delivery else None}}

    def forward(self):
        retry_seconds = 1
        while not self.stop.is_set():
            if self.delivery:
                okay = self.delivery.flush()
                retry_seconds = 1 if okay else min(30, retry_seconds * 2)
            self.stop.wait(retry_seconds)

    def start_camera(self):
        with self.lock:
            if self.source == 'synthetic':
                raise RuntimeError('Synthetic mode has no camera')
            if self.camera_thread is not None and self.camera_thread.is_alive():
                return False
            self.camera_stop = threading.Event()
            self.camera_active = True
            self.consent_at = utc_now()
            self.status, self.message = 'starting', 'Starting camera after consent.'
            self.detector.reset_tracks()
            self.camera_thread = threading.Thread(target=self.camera, args=(self.video_input, self.camera_stop),
                                                  daemon=True)
            self.camera_thread.start()
            return True

    def stop_camera(self, timeout=10):
        with self.lock:
            thread = self.camera_thread
            self.camera_stop.set()
        if thread is not None:
            thread.join(timeout=timeout)
        with self.lock:
            stopped = thread is None or not thread.is_alive()
            if stopped:
                self.camera_thread = None
                self.camera_active = False
                self.preview_jpeg = None
                self.tracks = []
                if self.status != 'unavailable':
                    self.status = 'stopped'
                    self.message = 'Camera stopped. Open incidents stay open.'
            return stopped

    def synthetic(self):
        self.status = 'running'
        try:
            while not self.stop.is_set():
                with self.lock:
                    self.frame(synthetic_observations(self.scenario), time.monotonic(), [640, 360])
                self.stop.wait(0.1)
        except Exception as failure:
            self._mark_unavailable(failure)

    def _mark_unavailable(self, failure):
        with self.lock:
            self.status = 'unavailable'
            self.message = str(failure)
            self.tracks = []

    def camera(self, video, stop_event):
        feed = CameraFeed(video, self.source, ROOT / '.data' / 'yolov8n.pt')
        try:
            self.message = 'Loading YOLOv8n; first run may download model weights.'
            feed.load()
            if stop_event.is_set() or self.stop.is_set():
                return
            feed.connect()
            self.status = 'running'
            self.message = 'Camera active: local inference and loopback preview; no images/video stored.'
            feed.begin_clock()
            while not (stop_event.is_set() or self.stop.is_set()):
                packet = feed.read()
                if packet is None:
                    with self.lock:
                        self.status = 'stopped'
                        self.message = 'Input ended or capture interrupted; incidents stay open.'
                        self.tracks = []
                    break
                self.frame(packet.observations, packet.timestamp, packet.dimensions)
                thumbnail = feed.preview(packet)
                if thumbnail is not None and not stop_event.is_set():
                    with self.lock:
                        self.preview_jpeg = thumbnail
                feed.advance()
                if self.source == 'recorded_fixture':
                    stop_event.wait(1 / feed.fps)
        except Exception as failure:
            self._mark_unavailable(failure)
        finally:
            feed.release()
            with self.lock:
                self.preview_jpeg = None
                self.camera_active = False
