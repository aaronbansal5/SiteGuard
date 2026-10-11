"""Opt-in metadata-only durable event forwarding to the local SiteGuard API."""
import json
import os
import urllib.request
from urllib.parse import urlparse


class Delivery:
    def __init__(self, store, origin, token):
        parsed = urlparse(origin)
        if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError('SITEGUARD_API_ORIGIN must be an HTTP 127.0.0.1 origin')
        if len(token) < 16:
            raise ValueError('SITEGUARD_MEASUREMENT_TOKEN must have at least 16 characters')
        self.store, self.url, self.token = store, origin.rstrip('/') + '/api/safety/events', token
        self.last_error = None

    def flush(self):
        for event in self.store.pending():
            request = urllib.request.Request(self.url, data=json.dumps(event).encode(),
                                             headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token})
            # No redirects: never forward the internal credential elsewhere.
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args):
                    return None
            try:
                with urllib.request.build_opener(NoRedirect).open(request, timeout=3) as response:
                    reply = json.load(response)
                    if response.status not in (200, 201) or reply.get('incidentId') != event['eventId']:
                        raise ValueError('Application did not acknowledge this event')
                self.store.delivered(event['eventId'])
                self.last_error = None
            except Exception:
                self.last_error = 'Event delivery failed; metadata retained locally for retry. Check API, credential and source policy.'
                return False
        return True


def from_environment(store):
    origin, token = os.getenv('SITEGUARD_API_ORIGIN'), os.getenv('SITEGUARD_MEASUREMENT_TOKEN')
    if not origin and not token:
        return None
    if not origin or not token:
        raise ValueError('Set both SITEGUARD_API_ORIGIN and SITEGUARD_MEASUREMENT_TOKEN to enable forwarding')
    return Delivery(store, origin, token)
