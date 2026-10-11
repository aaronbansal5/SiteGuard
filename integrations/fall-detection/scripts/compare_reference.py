"""Report exact normalized source runs; this is not an originality certificate.

Usage: python3 scripts/compare_reference.py /path/to/siteops-final
Reference files are read locally and never copied into the application.
"""
import argparse
import difflib
import json
from pathlib import Path


def source_lines(path):
    return [line.strip() for line in path.read_text().splitlines()
            if line.strip() and not line.lstrip().startswith('#')]


def inspect(reference):
    project = Path(__file__).resolve().parents[1] / 'fall_detection'
    comparisons = []
    maximum = 0
    files = list((reference / 'src').rglob('*.py'))
    for own in sorted(project.glob('*.py')):
        current = source_lines(own)
        for upstream in files:
            blocks = difflib.SequenceMatcher(None, current, source_lines(upstream), autojunk=False).get_matching_blocks()
            longest = max((block.size for block in blocks), default=0)
            maximum = max(maximum, longest)
            if longest >= 4:
                comparisons.append(dict(file=own.name, reference=str(upstream.relative_to(reference)), lines=longest))
    return dict(applicationFiles=len(list(project.glob('*.py'))), referenceFiles=len(files),
                maximumMatchingRun=maximum, runsOfFourOrMore=comparisons)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    options = parser.parse_args()
    if not (options.reference / 'src').is_dir():
        parser.error('Expected a checked-out reference repository with a src directory')
    result = inspect(options.reference)
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if result['runsOfFourOrMore'] else 0)
