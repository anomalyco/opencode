# -*- coding: utf-8 -*-
"""Validate that be.ts files are in parity with en.ts (keys + placeholders)."""
import io
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PATTERN = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.MULTILINE)


def parse(path):
    src = open(path, encoding="utf-8").read()
    d = {}
    for m in PATTERN.finditer(src):
        k = m.group(1)
        raw = m.group(2)
        val = raw[1:-1]
        val = re.sub(r'\\(["\\/])', r'\1', val)
        d[k] = val
    return d


def ph(v):
    return sorted(re.findall(r'\{\{\s*([^}]+?)\s*\}\}', v))


for name, en, be in [
    ("app", "packages/app/src/i18n/en.ts", "packages/app/src/i18n/be.ts"),
    ("ui", "packages/ui/src/i18n/en.ts", "packages/ui/src/i18n/be.ts"),
    ("desktop", "packages/desktop/src/renderer/i18n/en.ts", "packages/desktop/src/renderer/i18n/be.ts"),
    ("console", "packages/console/app/src/i18n/en.ts", "packages/console/app/src/i18n/be.ts"),
]:
    e = parse(en)
    b = parse(be)
    missing = [k for k in e if k not in b]
    extra = [k for k in b if k not in e]
    ph_mismatch = [k for k in e if k in b and ph(e[k]) != ph(b[k])]
    print("[%s] en=%d be=%d missing=%d extra=%d ph_mismatch=%d" % (name, len(e), len(b), len(missing), len(extra), len(ph_mismatch)))
    if missing:
        print("  MISSING:", missing[:12])
    if ph_mismatch:
        print("  PH_MISMATCH:", ph_mismatch[:12])
