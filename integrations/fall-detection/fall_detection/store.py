import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        ''')

    def record(self, observation, source, run_id, sequence, camera_id, zone_id):
        event = dict(observation, protocolVersion=1, eventId=str(uuid.uuid4()),
                     detectorRunId=run_id, sequence=sequence, cameraId=camera_id,
                     zoneId=zone_id, observedAt=utc_now(), kind='possible_person_down',
                     source=source, method='bbox-aspect-v1')
        incident = dict(event, id=event['eventId'], status='open', note=None)
        with self.lock, self.db:
            self.db.execute('INSERT INTO events VALUES (?,?)', (event['eventId'], json.dumps(event)))
            self.db.execute('INSERT INTO incidents VALUES (?,?)', (incident['id'], json.dumps(incident)))
        return event

    def list(self, table, limit=100):
        if table not in ('events', 'incidents', 'actions'):
            raise ValueError('Unknown table')
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute(
                'SELECT payload FROM ' + table + ' ORDER BY rowid DESC LIMIT ?', (limit,))]

    def action(self, incident_id, action, note):
        if action not in ('acknowledge', 'resolve', 'false_alarm'):
            raise ValueError('Invalid action')
        if not isinstance(note, str) or len(note) > 1000:
            raise ValueError('Note must be text, at most 1000 characters')
        if action != 'acknowledge' and not note.strip():
            raise ValueError('Resolution requires a note')
        with self.lock, self.db:
            row = self.db.execute('SELECT payload FROM incidents WHERE id=?', (incident_id,)).fetchone()
            if row is None:
                raise KeyError('Incident not found')
            incident = json.loads(row[0])
            if incident['status'] in ('resolved', 'false_alarm'):
                raise ValueError('Incident is already closed')
            incident.update(status={'acknowledge': 'acknowledged', 'resolve': 'resolved',
                                    'false_alarm': 'false_alarm'}[action], note=note.strip() or None)
            self.db.execute('UPDATE incidents SET payload=? WHERE id=?', (json.dumps(incident), incident_id))
            audit = {'incidentId': incident_id, 'action': action, 'note': note,
                     'createdAt': utc_now()}
            self.db.execute('INSERT INTO actions VALUES (?,?)', (str(uuid.uuid4()), json.dumps(audit)))
            return incident
