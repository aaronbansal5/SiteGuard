"""Read-only similarity evidence; results cannot certify independent authorship."""
import argparse
import ast
import copy
import difflib
import hashlib
import io
import json
from pathlib import Path
import tokenize


class CanonicalNames(ast.NodeTransformer):
    """Erase identifiers and literals to detect renamed structural matches."""
    def visit(self, node):
        node = super().visit(node)
        for field in ('id', 'arg', 'attr', 'name', 'asname'):
            if hasattr(node, field):
                setattr(node, field, '_')
        if isinstance(node, ast.Constant):
            node.value = None
        return node


def tokens(source):
    excluded = {tokenize.COMMENT, tokenize.ENCODING, tokenize.NL,
                tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}
    return [part.string for part in tokenize.generate_tokens(io.StringIO(source).readline)
            if part.type not in excluded]


def structures(source):
    result = {}
    for node in ast.walk(ast.parse(source)):
        # Full statement subtrees: avoid comparing isolated operators/names.
        if not isinstance(node, ast.stmt):
            continue
        size = sum(1 for _ in ast.walk(node))
        if size < 20:
            continue
        canonical = CanonicalNames().visit(copy.deepcopy(node))
        digest = hashlib.sha256(ast.dump(canonical, include_attributes=False).encode()).hexdigest()
        result.setdefault(digest, []).append(dict(line=node.lineno, nodes=size,
                                                 kind=type(node).__name__))
    return result


def audit(application, reference):
    app_files = sorted(application.glob('*.py'))
    reference_files = sorted(reference.rglob('*.py'))
    entries = {}
    for path in app_files + reference_files:
        source = path.read_text()
        entries[path] = dict(sha256=hashlib.sha256(source.encode()).hexdigest(),
                             tokens=tokens(source), structures=structures(source))
    token_runs, structural_matches, identical_files = [], [], []
    for own in app_files:
        for upstream in reference_files:
            current, other = entries[own], entries[upstream]
            labels = dict(application=own.name, reference=str(upstream.relative_to(reference)))
            if current['sha256'] == other['sha256']:
                identical_files.append(labels)
            blocks = difflib.SequenceMatcher(None, current['tokens'], other['tokens'], autojunk=False).get_matching_blocks()
            longest = max(blocks, key=lambda block: block.size)
            if longest.size >= 20:
                token_runs.append(dict(**labels, tokens=longest.size,
                                       text=' '.join(current['tokens'][longest.a:longest.a + longest.size])))
            for digest in current['structures'].keys() & other['structures'].keys():
                structural_matches.append(dict(**labels, applicationNodes=current['structures'][digest],
                                               referenceNodes=other['structures'][digest]))
    return dict(scope='Application runtime Python versus supplied reference Python; excludes dependencies, tests and UI',
                applicationFiles=len(app_files), referenceFiles=len(reference_files),
                identicalFiles=identical_files, tokenRunsAtLeast20=token_runs,
                identifierAndLiteralErasedStatementMatchesAtLeast20Nodes=structural_matches,
                fileDigests={str(path): entry['sha256'] for path, entry in entries.items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not args.reference.is_dir():
        parser.error('Reference source directory does not exist')
    result = audit(Path(__file__).resolve().parents[1] / 'fall_detection', args.reference)
    payload = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.write_text(payload)
        print(json.dumps({key: value for key, value in result.items() if key != 'fileDigests'}, indent=2))
    else:
        print(payload)
