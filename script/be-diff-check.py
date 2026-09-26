# -*- coding: utf-8 -*-
import csv
import io
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PAT = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.M)
BACK = "\\"


def un(raw):
    inner = raw[1:-1]
    out = []
    i = 0
    while i < len(inner):
        c = inner[i]
        if c == BACK and i + 1 < len(inner):
            n = inner[i + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", '"': '"', BACK: BACK}.get(n, n))
            i += 2
        else:
            out.append(c)
            i += 1
    return "".join(out)


src = open("packages/app/src/i18n/be.ts", encoding="utf-8").read()
be = {m.group(1): un(m.group(2)) for m in PAT.finditer(src)}
csvp = os.path.join("..", "be-translation-review.csv")
if not os.path.exists(csvp):
    csvp = "be-translation-review.csv"
rows = list(csv.DictReader(open(csvp, encoding="utf-8-sig")))
n = 0
for r in rows:
    k = r["key"]
    v = r["belarusian"]
    if k in be and v != be[k]:
        n += 1
        print(repr(k))
        print("  be.ts:", repr(be[k]))
        print("  csv  :", repr(v))
        if n >= 12:
            break
print("total diffs:", n)
