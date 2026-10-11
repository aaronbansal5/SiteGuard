import json
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone

CLOSED = ('resolved', 'false_alarm')
UNRESOLVED = ('open', 'acknowledged')


def utc_iso(moment):
    # Fixed millisecond precision keeps ISO strings lexicographically ordered.
    return moment.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def utc_now():
    return utc_iso(datetime.now(timezone.utc))


class Store:
    def __init__(self, path):
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS incidents(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS delivery(event_id TEXT PRIMARY KEY REFERENCES events(id), delivered_at TEXT);
        ''')

    def record(self, observation, source, run_id, sequence, camera_id, zone_id, observed_at=None):
        event = dict(observation, protocolVersion=1, eventId=str(uuid.uuid4()),
                     detectorRunId=run_id, sequence=sequence, cameraId=camera_id,
                     zoneId=zone_id, observedAt=observed_at or utc_now(), kind='possible_person_down',
                     source=source, method='bbox-aspect-v1')
        incident = dict(event, id=event['eventId'], status='open', note=None)
        with self.lock, self.db:
            self.db.execute('INSERT INTO events VALUES (?,?)', (event['eventId'], json.dumps(event)))
            self.db.execute('INSERT INTO incidents VALUES (?,?)', (incident['id'], json.dumps(incident)))
            self.db.execute('INSERT INTO delivery VALUES (?,NULL)', (event['eventId'],))
        return event

    def list(self, table, limit=100):
        if table not in ('events', 'incidents', 'actions'):
            raise ValueError('Unknown table')
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute(
                'SELECT payload FROM ' + table + ' ORDER BY rowid DESC LIMIT ?', (limit,))]

    def review_queue(self, limit=100):
        """All unresolved incidents plus the newest closed ones, newest first.

        A plain newest-N listing would silently hide an older open incident
        once enough newer ones arrived; unresolved work must stay visible.
        """
        with self.lock:
            rows = self.db.execute(
                'SELECT rowid, payload FROM incidents WHERE rowid IN ('
                ' SELECT rowid FROM incidents'
                " WHERE json_extract(payload, '$.status') IN ('open', 'acknowledged')"
                ' UNION SELECT rowid FROM (SELECT rowid FROM incidents ORDER BY rowid DESC LIMIT ?))'
                ' ORDER BY rowid DESC', (limit,)).fetchall()
            return [json.loads(row[1]) for row in rows]

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
            if incident['status'] in CLOSED:
                incident['closedAt'] = utc_now()
            self.db.execute('UPDATE incidents SET payload=? WHERE id=?', (json.dumps(incident), incident_id))
            audit = {'incidentId': incident_id, 'action': action, 'note': note,
                     'createdAt': utc_now()}
            self.db.execute('INSERT INTO actions VALUES (?,?)', (str(uuid.uuid4()), json.dumps(audit)))
            return incident

    def unresolved_regions(self, camera_id):
        """Normalized regions of open/acknowledged incidents for one camera."""
        with self.lock:
            rows = self.db.execute(
                "SELECT json_extract(payload, '$.evidence.region') FROM incidents"
                " WHERE json_extract(payload, '$.status') IN (?, ?)"
                " AND json_extract(payload, '$.cameraId') = ?", UNRESOLVED + (camera_id,)).fetchall()
        return [json.loads(row[0]) for row in rows if row[0]]

    def prune(self, retention_days, now=None):
        """Delete CLOSED incidents (plus their events/actions) older than the window.

        Open and acknowledged incidents, and their events/actions, are never
        pruned regardless of age. Returns counts of deleted rows.
        """
        if not isinstance(retention_days, int) or retention_days < 1:
            raise ValueError('Retention must be a whole number of days >= 1')
        cutoff = utc_iso((now or datetime.now(timezone.utc)) - timedelta(days=retention_days))
        closed_at = "COALESCE(json_extract(payload, '$.closedAt'), json_extract(payload, '$.observedAt'))"
        with self.lock, self.db:
            ids = [row[0] for row in self.db.execute(
                'SELECT id FROM incidents WHERE json_extract(payload, \'$.status\') IN (?, ?)'
                ' AND ' + closed_at + ' < ?', CLOSED + (cutoff,))]
            counts = {'incidents': 0, 'events': 0, 'actions': 0}
            for incident_id in ids:
                counts['incidents'] += self.db.execute('DELETE FROM incidents WHERE id=?', (incident_id,)).rowcount
                counts['events'] += self.db.execute('DELETE FROM events WHERE id=?', (incident_id,)).rowcount
                counts['actions'] += self.db.execute(
                    "DELETE FROM actions WHERE json_extract(payload, '$.incidentId')=?", (incident_id,)).rowcount
            # Orphans (no incident row) past the window.
            counts['events'] += self.db.execute(
                "DELETE FROM events WHERE id NOT IN (SELECT id FROM incidents)"
                " AND json_extract(payload, '$.observedAt') < ?", (cutoff,)).rowcount
            counts['actions'] += self.db.execute(
                "DELETE FROM actions WHERE json_extract(payload, '$.incidentId') NOT IN (SELECT id FROM incidents)"
                " AND json_extract(payload, '$.createdAt') < ?", (cutoff,)).rowcount
            self.db.execute('DELETE FROM delivery WHERE event_id NOT IN (SELECT id FROM events)')
        return counts

    def pending(self):
        with self.lock:
            return [json.loads(row[0]) for row in self.db.execute(
                'SELECT e.payload FROM events e JOIN delivery d ON e.id=d.event_id WHERE d.delivered_at IS NULL ORDER BY e.rowid LIMIT 100')]

    def delivered(self, event_id):
        with self.lock, self.db:
            self.db.execute('UPDATE delivery SET delivered_at=? WHERE event_id=?', (utc_now(), event_id))
