#!/usr/bin/env python3
"""Auditable in-place rebranding. Dry-run by default; backups stay outside the repository.

Uses only Python's standard library. Run --help for apply and restore commands.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import unicodedata
from urllib.parse import urlsplit

SKIP = {'.git', 'node_modules', 'target', 'vendor', '.venv', 'venv', '__pycache__', 'out', 'cache', 'build', 'dist'}
LEGAL = re.compile(r'^(license|licence|copying|notice|authors)(\..*)?$', re.I)
BRAND = re.compile(r'null[_-]?mask', re.I)
URL = re.compile(r'https?://[^\s<>"\x27`\\)\]}]+', re.I)
ADDRESS = re.compile(r'\b(?:0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b')
DEV_VALUE = re.compile(
    r'(?P<prefix>["\x27]?(?:dev(?:eloper)?(?:_?wallet|_?address)?|fee_?recipient)["\x27]?\s*[:=]\s*)'
    r'(?P<quote>["\x27]?)(?P<value>0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})(?P=quote)', re.I)
RPC_VALUE = re.compile(
    r'(?P<prefix>["\x27]?[A-Za-z_]*(?:rpc(?:_?url)?|api_?(?:url|route|endpoint)|base_?url)["\x27]?\s*[:=]\s*)'
    r'(?P<quote>["\x27])(?P<value>https?://[^"\x27]+|/api/[^"\x27]*)(?P=quote)', re.I)


def identity(match: re.Match) -> str:
    old = match.group()
    separator = '_' if '_' in old else '-' if '-' in old else ''
    if separator:
        value = f'cipher{separator}shroud'
        if old.isupper():
            return value.upper()
        if old[0].isupper():
            return separator.join(part.capitalize() for part in value.split(separator))
        return value
    if old.isupper():
        return 'CIPHERSHROUD'
    if old[0].isupper():
        return 'CipherShroud'
    if any(c.isupper() for c in old):
        return 'cipherShroud'
    return 'ciphershroud'


def rename_text(text: str, ticker_mode: str) -> str:
    text = BRAND.sub(identity, text)
    # Identifier segments, not substrings such as bitmask, unmask, or masked.
    token = r'(?i:MASK)' if ticker_mode == 'all' else 'MASK'
    pattern = r'(?<![A-Za-z0-9])' + token + r'(?=$|[^A-Za-z0-9]|[A-Z][a-z])'
    def ticker(match):
        old = match.group()
        return 'SHROUD' if old.isupper() else 'Shroud' if old[0].isupper() else 'shroud'
    return re.sub(pattern, ticker, text)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def decode(data: bytes):
    if data.startswith(b'\xff\xfe') or data.startswith(b'\xfe\xff'):
        encoding = 'utf-16'
    elif b'\0' in data:
        return None
    else:
        encoding = 'utf-8-sig' if data.startswith(b'\xef\xbb\xbf') else 'utf-8'
    try:
        return data.decode(encoding), encoding
    except UnicodeError:
        return None


def load_manifest(file: Path | None):
    manifest = json.loads(file.read_text()) if file else {}
    if set(manifest) - {'replacements', 'legacy_hosts', 'protected_paths'}:
        raise ValueError('Unknown manifest key')
    replacements = manifest.get('replacements', {})
    if not isinstance(replacements, dict) or any(not isinstance(k, str) or not k or not isinstance(v, str) for k, v in replacements.items()):
        raise ValueError('replacements must map nonempty strings to strings')
    for key in ('legacy_hosts', 'protected_paths'):
        if not isinstance(manifest.get(key, []), list) or any(not isinstance(x, str) for x in manifest.get(key, [])):
            raise ValueError(f'{key} must be a list of strings')
    return manifest


def transform(text, ticker_mode, manifest):
    result = []
    for line in text.splitlines(keepends=True):
        # Preserve upstream attribution and SPDX metadata even within source files.
        if re.search(r'copyright|SPDX-License-Identifier', line, re.I):
            result.append(line)
            continue
        for old, new in sorted(manifest.get('replacements', {}).items(), key=lambda x: -len(x[0])):
            line = line.replace(old, new)
        line = DEV_VALUE.sub(lambda m: m['prefix'] + m['quote'] + 'PLACEHOLDER_DEV_WALLET' + m['quote'], line)
        def endpoint(m):
            kind = 'SOLANA_RPC' if 'solana' in m[0].lower() else 'EVM_RPC' if 'rpc' in m['prefix'].lower() else 'API_BASE'
            return m['prefix'] + m['quote'] + f'YOUR_NEW_{kind}_URL' + m['quote']
        line = RPC_VALUE.sub(endpoint, line)
        def legacy_url(m):
            value = m.group()
            host = (urlsplit(value).hostname or '').lower()
            explicit = any(host == h.lower() or host.endswith('.' + h.lower()) for h in manifest.get('legacy_hosts', []))
            social = host in {'x.com', 'twitter.com', 't.me', 'discord.gg', 'discord.com', 'www.twitter.com', 'www.x.com'}
            if explicit or BRAND.search(host) or (social and BRAND.search(value)):
                return 'PLACEHOLDER_OFFICIAL_SOCIAL_URL' if social else 'YOUR_NEW_API_BASE_URL'
            return value
        line = URL.sub(legacy_url, line)
        result.append(rename_text(line, ticker_mode))
    return ''.join(result)


def relative_key(path: Path):
    return unicodedata.normalize('NFC', path.as_posix()).casefold()


def plan(root: Path, manifest, ticker_mode, excluded_files=()):
    entries, files, skipped = [], [], []
    excluded = {Path(p).resolve() for p in excluded_files}
    for directory, dirs, names in os.walk(root, followlinks=False):
        base = Path(directory)
        for name in sorted(dirs + names):
            path = base / name
            rel = path.relative_to(root)
            protected = any(rel == Path(p) or Path(p) in rel.parents for p in manifest.get('protected_paths', []))
            if name in SKIP or name.startswith('.rebrand-') or protected or path.resolve() in excluded:
                if name in dirs:
                    dirs.remove(name)
                # Retain excluded nodes in collision checks, without renaming their basenames.
                entries.append((rel, False))
                skipped.append({'path': str(rel), 'reason': 'excluded'})
                continue
            if path.is_symlink():
                if name in dirs:
                    dirs.remove(name)
                raise ValueError(f'Symlink requires manual review before migration: {rel}')
            entries.append((rel, True))
            if path.is_dir():
                continue
            if not path.is_file() or path.stat().st_nlink > 1:
                raise ValueError(f'Non-regular file or hard link requires manual review: {rel}')
            if LEGAL.match(name):
                skipped.append({'path': str(rel), 'reason': 'legal attribution'})
                continue
            data = path.read_bytes()
            decoded = decode(data)
            if decoded is None:
                skipped.append({'path': str(rel), 'reason': 'binary'})
                continue
            text, encoding = decoded
            updated = transform(text, ticker_mode, manifest).encode(encoding)
            # Reports expose locations and counts, never endpoint credentials or literal addresses.
            candidates = sum(1 for _ in ADDRESS.finditer(updated.decode(encoding)))
            if candidates:
                skipped.append({'path': str(rel), 'reason': 'unclassified address-like tokens', 'count': candidates})
            if updated != data:
                files.append({'path': str(rel), 'before': data, 'after': updated, 'mode': stat.S_IMODE(path.stat().st_mode)})
    eligibility = dict(entries)
    def destination(rel):
        parts, old = [], Path()
        for part in rel.parts:
            old /= part
            parts.append(rename_text(part, ticker_mode) if eligibility.get(old, False) and not LEGAL.match(part) else part)
        return Path(*parts)
    seen = {}
    for rel, _ in entries:
        key = relative_key(destination(rel))
        if key in seen:
            raise ValueError(f'Case-insensitive destination collision: {seen[key]} and {rel}')
        seen[key] = rel
    renames = []
    for rel, eligible in sorted(entries, key=lambda x: len(x[0].parts), reverse=True):
        new = rename_text(rel.name, ticker_mode) if eligible and not LEGAL.match(rel.name) else rel.name
        if new != rel.name:
            renames.append({'old': str(rel), 'new': str(rel.with_name(new))})
    for change in files:
        change['destination'] = str(destination(Path(change['path'])))
    return files, renames, skipped


def atomic_write(path: Path, data: bytes, mode: int):
    fd, temporary = tempfile.mkstemp(prefix='.rebrand-write-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def apply(root, files, renames, rename_root=False):
    root = root.resolve(strict=True)
    original_root = root
    next_root = root.with_name(rename_text(root.name, 'uppercase')) if rename_root else root
    if next_root != root and any(relative_key(p) == relative_key(next_root) for p in root.parent.iterdir() if p != root):
        raise ValueError(f'Repository root destination exists: {next_root.name}')
    backup = Path(tempfile.mkdtemp(prefix='.rebrand-backup-', dir=root.parent)).resolve()
    os.chmod(backup, 0o700)
    journal = {'root': str(root), 'original_root': str(original_root), 'files': [], 'renames': renames, 'state': 'prepared'}
    for i, change in enumerate(files):
        target = backup / str(i)
        target.write_bytes(change['before'])
        os.chmod(target, 0o600)
        journal['files'].append({k: v for k, v in change.items() if k not in {'before', 'after'}} | {
            'backup': str(i), 'before_hash': digest(change['before']), 'after_hash': digest(change['after'])})
    journal_file = backup / 'journal.json'
    journal_file.write_text(json.dumps(journal, indent=2) + '\n')
    moved, written = [], []
    try:
        for change in files:
            path = root / change['path']
            if path.read_bytes() != change['before']:
                raise ValueError(f'File changed during planning: {change["path"]}')
            atomic_write(path, change['after'], change['mode'])
            written.append(change)
        for move in renames:
            source, target = root / move['old'], root / move['new']
            if target.exists() and not os.path.samefile(source, target):
                raise ValueError(f'Destination appeared during migration: {move["new"]}')
            source.rename(target)
            moved.append(move)
        if next_root != root:
            root.rename(next_root)
            root = next_root
            journal['root'] = str(root)
        journal['state'] = 'complete'
        journal_file.write_text(json.dumps(journal, indent=2) + '\n')
    except BaseException:
        if root != original_root:
            root.rename(original_root)
            root = original_root
            journal['root'] = str(root)
        for move in reversed(moved):
            (root / move['new']).rename(root / move['old'])
        for change in written:
            atomic_write(root / change['path'], change['before'], change['mode'])
        journal['state'] = 'rolled-back'
        journal_file.write_text(json.dumps(journal, indent=2) + '\n')
        raise
    return backup


def restore(backup):
    backup = backup.resolve(strict=True)
    journal = json.loads((backup / 'journal.json').read_text())
    if journal['state'] != 'complete':
        raise ValueError('Automatic restore requires a completed migration. Inspect incomplete backups manually.')
    root = Path(journal['root']).resolve(strict=True)
    original_root = Path(journal.get('original_root', str(root)))
    if original_root.parent != root.parent:
        raise ValueError('Unsafe original repository path')
    if original_root != root and original_root.exists() and not os.path.samefile(original_root, root):
        raise ValueError('Original repository path is occupied')
    def checked(base, name):
        value = (base / name).resolve()
        if value == base or base not in value.parents:
            raise ValueError('Unsafe journal path')
        return value
    for move in journal['renames']:
        checked(root, move['new'])
        checked(root, move['old'])
    for change in journal['files']:
        target = checked(root, change['destination'])
        source = checked(backup, change['backup'])
        if digest(target.read_bytes()) != change['after_hash'] or digest(source.read_bytes()) != change['before_hash']:
            raise ValueError(f'Refusing to overwrite edits or corrupted backup: {change["destination"]}')
    # Validate reverse moves against a simulated set before moving any paths.
    existing = {str(p.relative_to(root)) for p in root.rglob('*')}
    for move in reversed(journal['renames']):
        old, new = move['old'], move['new']
        if new not in existing or (old in existing and old != new):
            raise ValueError(f'Restore rename collision or missing path: {old}')
        existing = {old + p[len(new):] if p == new or p.startswith(new + '/') else p for p in existing}
    for move in reversed(journal['renames']):
        (root / move['new']).rename(root / move['old'])
    for change in journal['files']:
        atomic_write(root / change['path'], (backup / change['backup']).read_bytes(), change['mode'])
    if original_root != root:
        root.rename(original_root)
        journal['root'] = str(original_root)
    journal['state'] = 'restored'
    (backup / 'journal.json').write_text(json.dumps(journal, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--ticker-mode', choices=['uppercase', 'all'], default='uppercase',
                        help='all also renames standalone Mask/mask; review CSS and generic mask identifiers')
    parser.add_argument('--apply', action='store_true', help='Apply the dry-run plan in place with an external backup')
    parser.add_argument('--rename-root', action='store_true', help='Also rename the repository root directory')
    parser.add_argument('--restore', type=Path, help='Restore a completed backup, refusing later content edits')
    args = parser.parse_args()
    if args.restore:
        restore(args.restore.resolve(strict=True))
        print('Restored migration.')
        return
    root = args.root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Repository root must be a directory')
    manifest = load_manifest(args.manifest)
    files, renames, skipped = plan(root, manifest, args.ticker_mode, [Path(__file__), *([args.manifest] if args.manifest else [])])
    report = {'mode': 'apply' if args.apply else 'dry-run', 'content_changes': [x['path'] for x in files],
              'renames': renames, 'review': skipped}
    if args.rename_root:
        report['root_destination'] = str(root.with_name(rename_text(root.name, 'uppercase')))
    if args.apply:
        report['backup'] = str(apply(root, files, renames, args.rename_root))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        print(f'Migration stopped: {error}', file=sys.stderr)
        sys.exit(1)
