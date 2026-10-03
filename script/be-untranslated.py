# -*- coding: utf-8 -*-
"""Find Belarusian values that still look untranslated (mostly English/Latin)."""
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PAT = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.M)
CYR = re.compile(r"[а-яёіўА-ЯЁІЎ]")
LAT = re.compile(r"[A-Za-z]")


def un(raw):
    inner = raw[1:-1]
    out = []
    i = 0
    while i < len(inner):
        c = inner[i]
        if c == "\\" and i + 1 < len(inner):
            out.append(inner[i + 1])
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


DOMAINS = [
    ("app", "packages/app/src/i18n"),
    ("ui", "packages/ui/src/i18n"),
    ("desktop", "packages/desktop/src/renderer/i18n"),
    ("console", "packages/console/app/src/i18n"),
]

total = 0
for domain, rel in DOMAINS:
    path = os.path.join(rel, "be.ts")
    if not os.path.exists(path):
        continue
    src = open(path, encoding="utf-8").read()
    for m in PAT.finditer(src):
        k, v = m.group(1), un(m.group(2))
        # strip placeholders / urls / backtick spans
        stripped = re.sub(r"\{\{[^{}]*\}\}", " ", v)
        stripped = re.sub(r"`[^`]*`", " ", stripped)
        stripped = re.sub(r"https?://\S+", " ", stripped)
        letters = LAT.findall(stripped)
        cyr = CYR.findall(stripped)
        # flag if there is English text but no Cyrillic at all
        if len(letters) >= 4 and len(cyr) == 0:
            total += 1
            print("[%s] %s" % (domain, k))
            print("   BE: %s" % v[:120])
print("TOTAL untranslated-looking:", total)
