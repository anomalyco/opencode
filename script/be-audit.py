# -*- coding: utf-8 -*-
"""Audit: list distinct Russian words in the source translations that are not
covered by WORD_MAP, so the dictionary can be completed."""
import io
import os
import re
import sys
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
WORD_MAP = set()
import glob

for p in [os.path.join(HERE, "be-locale-gen.py")] + sorted(glob.glob(os.path.join(HERE, "be_extra*.py"))):
    if not os.path.exists(p):
        continue
    src = open(p, encoding="utf-8").read()
    # Keys of WORD_MAP / PHRASE_MAP / EXTRA / EN_OVERRIDES are quoted strings
    # followed by a colon.
    WORD_MAP |= {k.lower().replace("ё", "е") for k in re.findall(r'"([^"\n]+)"\s*:', src)}

PATTERN = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.MULTILINE)
CYR = re.compile(r"[а-яёА-ЯЁ]+")


def unescape(raw):
    inner = raw[1:-1]
    out = []
    i = 0
    while i < len(inner):
        ch = inner[i]
        if ch == "\\" and i + 1 < len(inner):
            n = inner[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}.get(n, n))
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


files = [
    "packages/app/src/i18n/ru.ts",
    "packages/ui/src/i18n/ru.ts",
    "packages/desktop/src/renderer/i18n/ru.ts",
    "packages/console/app/src/i18n/ru.ts",
]
counter = Counter()
for f in files:
    if not os.path.exists(f):
        continue
    src = open(f, encoding="utf-8").read()
    for m in PATTERN.finditer(src):
        val = unescape(m.group(2))
        for w in CYR.findall(val):
            wl = w.lower().replace("ё", "е")
            if wl in WORD_MAP:
                continue
            if len(wl) < 3:
                continue
            counter[wl] += 1

print("distinct untranslated words:", len(counter))
print("total occurrences:", sum(counter.values()))
print()
for w, c in counter.most_common():
    print("%s" % (w), end=" ")
print()
