"""Loopback-only demo server. No authentication or production deployment support."""
import argparse
import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .detector import Detector, Observation, regions_overlap
from .store import Store, utc_now

ROOT = Path(__file__).resolve().parents[1]


CONSENT_TEXT = ('I confirm everyone in view has been told this camera is monitored locally, '
                'and I have their consent to run person detection.')
RETENTION_INTERVAL = 24 * 60 * 60


class Runtime:
    def __init__(self, store, source, camera_id, zone_id, video_input=0):
        self.store, self.source = store, source
        self.camera_id, self.zone_id = camera_id, zone_id
        self.video_input = video_input
        self.run_id, self.sequence = str(uuid.uuid4()), 0
        self.detector = Detector()
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

    def frame(self, observations, timestamp, frame_size):
        with self.lock:
            observations = list(observations)
            before = self.detector.suppressed
            events = self.detector.update(observations, timestamp, frame_size)
            self.suppressed_repeats += self.detector.suppressed - before
            self.tracks = [{'trackId': item.track_id, 'bbox': item.bbox,
                            'state': self.detector.classify(item, frame_size),
                            'horizontal': self.detector.classify(item, frame_size) == 'horizontal'}
                           for item in observations if item.bbox[2] > item.bbox[0]]
            self.frame_size = frame_size
            open_regions = self.store.unresolved_regions(self.camera_id) if events else []
            for event in events:
                region = event['evidence']['region']
                if any(regions_overlap(region, other, self.detector.region_iou, self.detector.region_centroid)
                       for other in open_regions):
                    # An unresolved incident already covers this spot.
                    self.suppressed_repeats += 1
                    continue
                self.sequence += 1
                self.store.record(event, self.source, self.run_id, self.sequence,
                                  self.camera_id, self.zone_id)
                open_regions.append(region)

    def state(self):
        with self.lock:
            return {'source': self.source, 'status': self.status, 'message': self.message,
                    'cameraActive': self.camera_active, 'consentAt': self.consent_at,
                    'consentText': None if self.source == 'synthetic' else CONSENT_TEXT,
                    'suppressedRepeats': self.suppressed_repeats,
                    'tracks': self.tracks, 'frameSize': self.frame_size,
                    'incidents': self.store.review_queue()}

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
                    scenario = self.scenario
                    bbox = (180, 80, 260, 300) if scenario == 'upright' else (150, 220, 390, 300)
                    observations = [] if scenario == 'missing' else [Observation('demo-person-1', bbox)]
                    self.frame(observations, time.monotonic(), [640, 360])
                self.stop.wait(0.1)
        except Exception as error:
            with self.lock:
                self.status, self.message, self.tracks = 'unavailable', str(error), []

    def camera(self, video, stop_event):
        capture = None
        try:
            import cv2
            from ultralytics import YOLO
            self.message = 'Loading YOLOv8n; first run may download model weights.'
            model = YOLO(str(ROOT / '.data' / 'yolov8n.pt'))
            if stop_event.is_set() or self.stop.is_set():
                return
            capture = cv2.VideoCapture(video)
            if not capture.isOpened():
                raise RuntimeError('Camera/video unavailable. Check permissions and input.')
            self.status, self.message = 'running', 'Camera active: local inference and loopback preview; no images/video stored.'
            start = time.monotonic()
            fps = capture.get(cv2.CAP_PROP_FPS)
            fps = fps if fps > 0 else 20
            frame_number = 0
            while not stop_event.is_set() and not self.stop.is_set():
                ok, frame = capture.read()
                if not ok:
                    with self.lock:
                        self.status, self.message, self.tracks = 'stopped', 'Input ended or capture interrupted; incidents stay open.', []
                    break
                results = model.track(frame, persist=True, classes=[0], conf=0.5,
                                      tracker='bytetrack.yaml', verbose=False)
                observations = []
                boxes = results[0].boxes
                if boxes is not None and boxes.id is not None:
                    for box, track, confidence in zip(boxes.xyxy.cpu().tolist(),
                                                     boxes.id.cpu().tolist(), boxes.conf.cpu().tolist()):
                        observations.append(Observation(str(int(track)), tuple(box), confidence))
                timestamp = time.monotonic() if self.source == 'camera' else start + frame_number / fps
                self.frame(observations, timestamp, [frame.shape[1], frame.shape[0]])
                preview = cv2.resize(frame, (640, int(frame.shape[0] * 640 / frame.shape[1])))
                encoded, jpeg = cv2.imencode('.jpg', preview, [cv2.IMWRITE_JPEG_QUALITY, 70])
                if encoded and not stop_event.is_set():
                    with self.lock:
                        self.preview_jpeg = jpeg.tobytes()
                frame_number += 1
                if self.source == 'recorded_fixture':
                    stop_event.wait(1 / fps)
        except Exception as error:
            with self.lock:
                self.status, self.message, self.tracks = 'unavailable', str(error), []
        finally:
            if capture is not None:
                capture.release()
            with self.lock:
                self.preview_jpeg = None
                self.camera_active = False


def retention_loop(store, days, stop, interval=RETENTION_INTERVAL):
    """Prune closed records at startup, then once per interval until stopped."""
    while True:
        try:
            counts = store.prune(days)
            if any(counts.values()):
                print('Retention: pruned %s (older than %d days)' % (counts, days), flush=True)
        except Exception as error:  # Keep serving; report and retry next interval.
            print('Retention prune failed: %s' % error, flush=True)
        if stop.wait(interval):
            return


def handler(runtime):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, body, content_type='application/json'):
            data = body if isinstance(body, bytes) else body.encode() if isinstance(body, str) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            # Stop other sites embedding the loopback camera preview or state.
            self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            # Loopback binding plus Host/Origin checks protect local demo writes.
            expected = '127.0.0.1:' + str(self.server.server_port)
            host = self.headers.get('Host', '')
            origin = self.headers.get('Origin')
            # Browsers omit Origin on cross-site <img>/navigation GETs; Fetch
            # Metadata lets us refuse those too. Non-browser clients send none.
            fetch_site = self.headers.get('Sec-Fetch-Site')
            return (host == expected and (origin is None or origin == 'http://' + expected)
                    and fetch_site in (None, 'same-origin', 'none'))

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {'error': 'Use the 127.0.0.1 dashboard origin'})
            if self.path == '/':
                return self.send(200, (ROOT / 'web' / 'index.html').read_text(), 'text/html; charset=utf-8')
            if self.path.split('?')[0] == '/api/preview':
                with runtime.lock:
                    jpeg = runtime.preview_jpeg
                return self.send(200, jpeg, 'image/jpeg') if jpeg else self.send(503, {'error': 'No live frame'})
            if self.path == '/api/state':
                return self.send(200, runtime.state())
            if self.path == '/api/events':
                return self.send(200, {'events': runtime.store.list('events', 1000)})
            return self.send(404, {'error': 'Not found'})

        def do_POST(self):
            if not self.allowed():
                return self.send(403, {'error': 'Invalid origin'})
            try:
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    raise ValueError('Use application/json')
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 4096:
                    raise ValueError('Invalid body size')
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected object')
                if self.path == '/api/demo':
                    if runtime.source != 'synthetic':
                        return self.send(409, {'error': 'Synthetic controls disabled in camera/video mode'})
                    if set(body) != {'scenario'} or body['scenario'] not in ('upright', 'horizontal', 'bend', 'missing'):
                        raise ValueError('Invalid scenario')
                    with runtime.lock:
                        runtime.scenario = body['scenario']
                        runtime.scenario_revision += 1
                        revision = runtime.scenario_revision
                    if body['scenario'] == 'bend':
                        def restore():
                            with runtime.lock:
                                if runtime.scenario == 'bend' and runtime.scenario_revision == revision:
                                    runtime.scenario = 'upright'
                        threading.Timer(0.6, restore).start()
                    return self.send(200, runtime.state())
                if self.path == '/api/camera/start':
                    if runtime.source == 'synthetic':
                        return self.send(409, {'error': 'Synthetic mode has no camera'})
                    if set(body) != {'consent'} or body['consent'] is not True:
                        raise ValueError('Camera start requires {"consent": true} after showing the monitoring notice')
                    runtime.start_camera()
                    return self.send(200, runtime.state())
                if self.path == '/api/camera/stop':
                    if runtime.source == 'synthetic':
                        return self.send(409, {'error': 'Synthetic mode has no camera'})
                    if body:
                        raise ValueError('Expected empty object')
                    if not runtime.stop_camera(timeout=4):
                        return self.send(503, {'error': 'Camera is still stopping; retry'})
                    return self.send(200, runtime.state())
                prefix = '/api/incidents/'
                if self.path.startswith(prefix):
                    if set(body) != {'action', 'note'}:
                        raise ValueError('Expected action and note')
                    incident = runtime.store.action(self.path[len(prefix):], body['action'], body['note'])
                    return self.send(200, {'incident': incident})
                return self.send(404, {'error': 'Not found'})
            except KeyError:
                self.send(404, {'error': 'Incident not found'})
            except (ValueError, TypeError) as error:
                self.send(400, {'error': str(error)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description='Standalone possible-person-down demo')
    parser.add_argument('--port', type=int, default=4322)
    parser.add_argument('--source', choices=['synthetic', 'camera', 'recorded_fixture'], default='synthetic')
    parser.add_argument('--camera', type=int, default=0)
    parser.add_argument('--video', type=Path)
    parser.add_argument('--camera-id', default='camera-01')
    parser.add_argument('--zone-id', default='demo-zone-a')
    parser.add_argument('--database', type=Path, default=ROOT / '.data' / 'incidents.sqlite')
    parser.add_argument('--retention-days', type=int, default=30,
                        help='Delete closed incidents and their events/actions after this many days (default 30)')
    args = parser.parse_args()
    if args.retention_days < 1:
        parser.error('--retention-days must be at least 1')
    if args.source == 'recorded_fixture' and (not args.video or not args.video.is_file()):
        parser.error('recorded_fixture requires --video with an existing local file')
    if args.source != 'recorded_fixture' and args.video:
        parser.error('--video is only accepted with recorded_fixture')
    args.database.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / '.data').mkdir(exist_ok=True)
    video_input = str(args.video) if args.video else args.camera
    runtime = Runtime(Store(args.database), args.source, args.camera_id, args.zone_id, video_input)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler(runtime))
    threads = [threading.Thread(target=retention_loop, args=(runtime.store, args.retention_days, runtime.stop),
                                daemon=True)]
    if args.source == 'synthetic':
        threads.append(threading.Thread(target=runtime.synthetic, daemon=True))
    for thread in threads:
        thread.start()
    print('Open http://127.0.0.1:%s — source=%s' % (server.server_port, args.source), flush=True)
    if args.source != 'synthetic':
        print('Camera is OFF until you confirm consent in the dashboard.', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.stop.set()
        runtime.stop_camera(timeout=5)
        server.server_close()
        for thread in threads:
            thread.join(timeout=5)


if __name__ == '__main__':
    main()
