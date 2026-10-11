import json
import unittest
import uuid
from unittest.mock import patch
from fall_detection.delivery import Delivery
from fall_detection.store import Store

class Reply:
    status = 201
    def __init__(self, value): self.value = value
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self): return json.dumps(self.value).encode()

class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.store = Store(':memory:')
        self.event = self.store.record({'trackId':'1','durationSeconds':2.1,'evidence':{'heightWidthRatio':0.5}}, 'camera', str(uuid.uuid4()), 1, 'cam', 'yard')
        self.delivery = Delivery(self.store, 'http://127.0.0.1:3001', 'a'*32)
    def tearDown(self): self.store.db.close()
    def test_delivery_and_explicit_database_resolution(self):
        class Opener:
            def open(inner, request, timeout):
                if request.full_url.endswith('/events'):
                    return Reply({'incidentId': self.event['eventId']})
                return Reply({'incidents':[{'id':self.event['eventId'],'status':'resolved','note':'Checked scene'}]})
        with patch('urllib.request.build_opener', return_value=Opener()):
            self.assertTrue(self.delivery.flush())
        self.assertEqual(self.store.pending(), [])
        self.assertEqual(self.store.review_queue()[0]['status'], 'resolved')
    def test_failed_delivery_retains_metadata(self):
        with patch('urllib.request.build_opener', side_effect=OSError('offline')):
            self.assertFalse(self.delivery.flush())
        self.assertEqual(len(self.store.pending()), 1)
        self.assertEqual(self.store.review_queue()[0]['status'], 'open')
    def test_unknown_response_id_cannot_clear_local_incident(self):
        self.store.delivered(self.event['eventId'])
        class Opener:
            def open(inner, request, timeout):
                return Reply({'incidents':[{'id':str(uuid.uuid4()),'status':'resolved','note':'Wrong incident'}]})
        with patch('urllib.request.build_opener', return_value=Opener()):
            self.assertFalse(self.delivery.flush())
        self.assertEqual(self.store.review_queue()[0]['status'], 'open')
