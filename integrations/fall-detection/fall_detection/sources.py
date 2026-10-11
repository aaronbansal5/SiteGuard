"""Observation-source boundary: no HTTP handlers or incident decisions."""
import time
from dataclasses import dataclass
from .geometry import Observation


def synthetic_observations(scenario):
    if scenario == 'missing':
        return []
    rectangle = (180, 80, 260, 300) if scenario == 'upright' else (150, 220, 390, 300)
    return [Observation('demo-person-1', rectangle)]


@dataclass
class CameraPacket:
    pixels: object
    observations: list
    timestamp: float
    dimensions: list


class CameraFeed:
    def __init__(self, address, mode, weights):
        self.address, self.mode, self.weights = address, mode, weights
        self.capture = None
        self.frame_index = 0

    def load(self):
        import cv2
        from ultralytics import YOLO
        self.cv = cv2
        self.network = YOLO(str(self.weights))

    def connect(self):
        self.capture = self.cv.VideoCapture(self.address)
        if not self.capture.isOpened():
            raise RuntimeError('Camera/video unavailable. Check permissions and input.')

    def begin_clock(self):
        self.epoch = time.monotonic()
        rate = self.capture.get(self.cv.CAP_PROP_FPS)
        self.fps = rate if rate > 0 else 20

    def read(self):
        available, pixels = self.capture.read()
        if not available:
            return None
        prediction = self.network.track(pixels, persist=True, classes=[0], conf=0.5,
                                        tracker='bytetrack.yaml', verbose=False)[0]
        observed = []
        detections = prediction.boxes
        if detections is not None and detections.id is not None:
            coordinates = detections.xyxy.cpu().tolist()
            identities = detections.id.cpu().tolist()
            certainties = detections.conf.cpu().tolist()
            observed = [Observation(str(int(identity)), tuple(bounds), certainty)
                        for bounds, identity, certainty in zip(coordinates, identities, certainties)]
        instant = time.monotonic() if self.mode == 'camera' else self.epoch + self.frame_index / self.fps
        return CameraPacket(pixels, observed, instant, [pixels.shape[1], pixels.shape[0]])

    def preview(self, packet):
        width, height = packet.dimensions
        thumbnail = self.cv.resize(packet.pixels, (640, int(height * 640 / width)))
        accepted, encoded = self.cv.imencode('.jpg', thumbnail, [self.cv.IMWRITE_JPEG_QUALITY, 70])
        return encoded.tobytes() if accepted else None

    def advance(self):
        self.frame_index += 1

    def release(self):
        if self.capture is not None:
            self.capture.release()
