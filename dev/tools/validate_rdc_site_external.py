#!/usr/bin/env python3
"""External validator for the Recettes du Coeur static site checkout.

This script intentionally lives outside the target repository so it can audit
an immutable checkout even when the GitHub connector only has read access to
the site repository.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import py_compile
import subprocess
import sys
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

IGNORED_PARTS = {'.git', '__pycache__'}
SKIP_PREFIXES = ('http://', 'https://', '//', 'mailto:', 'tel:', 'data:', 'blob:', 'javascript:', '#')
TEMPLATE_MARKERS = ('{{', '}}', '${', '<%', '%>')


def iter_files(root: pathlib.Path, ext: str):
    for path in root.rglob(f'*{ext}'):
        if not any(part in IGNORED_PARTS for part in path.parts):
            yield path


class Refs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.refs: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        for key in ('href', 'src', 'poster'):
            if data.get(key):
                self.refs.append((tag, key, data[key]))
        if data.get('srcset'):
            for item in data['srcset'].split(','):
                value = item.strip().split(' ')[0]
                if value:
                    self.refs.append((tag, 'srcset', value))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('root', type=pathlib.Path)
    parser.add_argument('--report', type=pathlib.Path)
    args = parser.parse_args()
    root = args.root.resolve()
    errors: list[dict] = []
    warnings: list[dict] = []
    counts = {'json': 0, 'javascript': 0, 'python': 0, 'shell': 0, 'html': 0, 'references': 0}

    for path in iter_files(root, '.json'):
        counts['json'] += 1
        try:
            json.loads(path.read_text(encoding='utf-8'))
        except Exception as exc:
            errors.append({'kind': 'json', 'path': str(path.relative_to(root)), 'message': str(exc)})

    for path in iter_files(root, '.py'):
        counts['python'] += 1
        try:
            py_compile.compile(str(path), doraise=True)
        except Exception as exc:
            errors.append({'kind': 'python', 'path': str(path.relative_to(root)), 'message': str(exc)})

    for path in iter_files(root, '.js'):
        counts['javascript'] += 1
        proc = subprocess.run(['node', '--check', str(path)], text=True, capture_output=True)
        if proc.returncode:
            errors.append({'kind': 'javascript', 'path': str(path.relative_to(root)), 'message': (proc.stderr or proc.stdout).strip()})

    for path in iter_files(root, '.sh'):
        counts['shell'] += 1
        proc = subprocess.run(['bash', '-n', str(path)], text=True, capture_output=True)
        if proc.returncode:
            errors.append({'kind': 'shell', 'path': str(path.relative_to(root)), 'message': (proc.stderr or proc.stdout).strip()})

    for path in iter_files(root, '.html'):
        counts['html'] += 1
        hp = Refs()
        try:
            hp.feed(path.read_text(encoding='utf-8', errors='replace'))
        except Exception as exc:
            warnings.append({'kind': 'html-parse', 'path': str(path.relative_to(root)), 'message': str(exc)})
            continue
        for _tag, _attr, raw in hp.refs:
            value = raw.strip()
            if not value or value.startswith(SKIP_PREFIXES) or any(x in value for x in TEMPLATE_MARKERS):
                continue
            pathpart = unquote(urlsplit(value).path)
            if not pathpart or pathpart == '/':
                continue
            candidate = (root / pathpart.lstrip('/')) if pathpart.startswith('/') else (path.parent / pathpart)
            candidate = candidate.resolve()
            try:
                candidate.relative_to(root)
            except ValueError:
                warnings.append({'kind': 'reference-outside-root', 'path': str(path.relative_to(root)), 'message': value})
                continue
            counts['references'] += 1
            if candidate.exists() or (candidate.suffix == '' and (candidate / 'index.html').exists()):
                continue
            errors.append({'kind': 'missing-reference', 'path': str(path.relative_to(root)), 'message': value})

    report = {'status': 'FAIL' if errors else 'PASS', 'counts': counts, 'errors': errors, 'warnings': warnings}
    out = args.report or (root / 'dev/reports/validation_external_latest.json')
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'counts': counts, 'errors': len(errors), 'warnings': len(warnings)}, ensure_ascii=False, indent=2))
    for item in errors[:150]:
        print('ERROR', json.dumps(item, ensure_ascii=False))
    if len(errors) > 150:
        print(f'... {len(errors)-150} additional errors')
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
