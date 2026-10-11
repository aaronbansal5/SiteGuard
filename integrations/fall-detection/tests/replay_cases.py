"""Reproducible multi-person input tapes for before/after equivalence checks."""
import hashlib
import json
import random


def configurations():
    return [dict(seed=seed, frames=500, settings={
        'min_duration': [0.7, 1.5, 2.4][seed % 3],
        'cooldown': [0, 3, 10][seed % 3],
        'region_cooldown': [0, 5, 60][(seed // 3) % 3],
        'max_gap': [0.2, 0.5, 0.8][seed % 3],
    }) for seed in range(24)]


def evaluate(detector, observation_type, specification):
    generator = random.Random(specification['seed'])
    phases = ['upright'] * 6
    instant = 0.0
    digest = hashlib.sha256()
    total_alerts = 0
    for frame in range(specification['frames']):
        instant += generator.choice([0.1, 0.1, 0.1, 0.2, 0.5, 0.51])
        if frame % 137 == 136:
            instant += 61
        if frame % 193 == 192:
            detector.reset_tracks()
        batch = []
        for person in range(6):
            if generator.random() < 0.09:
                phases[person] = generator.choice(['upright', 'horizontal', 'intermediate', 'ignored'])
            if generator.random() < 0.08:
                continue
            shift = person * 82
            boxes = {'upright': (35 + shift, 60, 75 + shift, 190),
                     'horizontal': (20 + shift, 160, 140 + shift, 205),
                     'intermediate': (35 + shift, 90, 105 + shift, 155),
                     'ignored': (0, 0, 640, 360)}
            identity = '%s-%s' % (person, frame // 101)
            confidence = 0.2 if generator.random() < 0.03 else 1.0
            batch.append(observation_type(identity, boxes[phases[person]], confidence))
        events = detector.update(batch, instant, (640, 360))
        total_alerts += len(events)
        snapshot = dict(events=events, states=detector.states,
                        regions=detector.alert_regions, suppressed=detector.suppressed,
                        poses=[detector.classify(item, (640, 360)) for item in batch])
        digest.update(json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode())
    return dict(digest=digest.hexdigest(), alerts=total_alerts, suppressed=detector.suppressed)
