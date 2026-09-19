# -*- coding: utf-8 -*-
"""List keys whose Belarusian value likely has grammar issues (case after "да",
"ИИ" instead of "АІ", etc.), with the Russian source for reference."""
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PAT = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.M)


def un(raw):
    inner = raw[1:-1]
    out = []
    i = 0
    while i < len(inner):
        c = inner[i]
        if c == "\\" and i + 1 < len(inner):
            n = inner[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


def parse(path):
    if not os.path.exists(path):
        return {}
    src = open(path, encoding="utf-8").read()
    return {m.group(1): un(m.group(2)) for m in PAT.finditer(src)}


DOMAINS = [
    ("app", "packages/app/src/i18n"),
    ("ui", "packages/ui/src/i18n"),
    ("console", "packages/console/app/src/i18n"),
]

markers = sys.argv[1:] or ["да ", "ИИ"]
for domain, rel in DOMAINS:
    ru = parse(os.path.join(rel, "ru.ts"))
    be = parse(os.path.join(rel, "be.ts"))
    for k, v in be.items():
        if any(m in v for m in markers):
            print("[%s] %s" % (domain, k))
            print("   RU: %s" % ru.get(k, ""))
            print("   BE: %s" % v)
