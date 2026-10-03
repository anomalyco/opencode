# -*- coding: utf-8 -*-
"""List frequent Russian word tokens that the WORD_MAP doesn't cover, to help
expand the dictionary. Reads ru.ts, tokenizes, and reports top uncounted words."""
import io
import re
import sys
from collections import Counter

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# Load the WORD_MAP keys from the generator source (approximate).
gen_src = open("script/be-locale-gen.py", encoding="utf-8").read()
# Extract all "russian": "belarusian" key strings from WORD_MAP block.
keys = set(re.findall(r'^\s*"([^"]+)"\s*:', gen_src, re.MULTILINE))
keys = {k.lower() for k in keys if not k.startswith("ui.") and not k.startswith("desktop.")}

PATTERN = re.compile(r'^\s*"([^"]+)":\s*("(?:[^"\\]|\\.)*"),?\s*$', re.MULTILINE)
RU_SPECIFIC = re.compile(r"[ыёщъ]+")
CYR = re.compile(r"[а-яё]+", re.IGNORECASE)

for path in ["packages/app/src/i18n/ru.ts", "packages/ui/src/i18n/ru.ts"]:
    src = open(path, encoding="utf-8").read()
    vals = []
    for m in PATTERN.finditer(src):
        raw = m.group(2)
        val = raw[1:-1]
        val = re.sub(r'\\(["\\/nrt])', lambda x: {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\"}.get(x.group(1), x.group(1)), val)
        vals.append(val)
    counter = Counter()
    for v in vals:
        for w in CYR.findall(v):
            wl = w.lower()
            # skip if covered by dictionary or common stopwords already mapped
            if wl in keys:
                continue
            # skip pure Russian that is likely a technical/loan term kept as-is
            if len(wl) < 3:
                continue
            counter[wl] += 1
    print("=== %s top words not in WORD_MAP ===" % path)
    for w, c in counter.most_common(60):
        print("%5d  %s" % (c, w))
