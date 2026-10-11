"""Loopback-only demo server. No authentication or production deployment support."""
import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .store import Store
from .runtime import Runtime, CONSENT_TEXT

ROOT = Path(__file__).resolve().parents[1]


RETENTION_INTERVAL = 24 * 60 * 60



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
                                daemon=True),
               threading.Thread(target=runtime.forward, daemon=True)]
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
