# Builds the site's OpenMono files. With the font build's folder as its argument (the "app-nerd" output
# of the OpenMono build, whose Regular, Bold and Italic OpenCode Desktop bundles too) it reads
# woff2/OpenMonoNerd-<Style>-text.woff2 and LICENSE from there and also writes them to
# src/docs/assets/fonts (as OpenMono-<Style>.woff2) and src/asset/fonts/OpenMono-OFL.txt; without one it
# rebuilds from those copies. The copies are OpenMono 1.000.
#
# Each style is three files, split by unicode-range like Inter: "latin" (Latin, punctuation, arrows,
# shapes, box drawing and a few keys and common symbols: what the site sets in mono), "cyrillic" (the
# Russian and Ukrainian pages, and those languages' names in a language menu) and "rest" (every other
# character the font has), each only fetched when a page uses one of its characters. No character is
# left out. OpenCode Desktop's script (packages/app/script/openmono.py) follows the same rules; with
# the same lists of keys and symbols as below, both make the same files. The ranges are written to
# src/asset/fonts/openmono.json for mono-fonts.ts; if they change, write them into
# src/style/fonts.css too (test/fonts.test.ts compares the two). packages/data/app serves copies of
# the regular and bold files; refresh them too.
#
# The app build has no ligatures and every character one cell wide (0.6 em, like the metric-matched
# fallbacks), so no CSS feature is needed. Only the layout features for accents are kept.
#
# Every input is read and checked and every file is built in a temporary folder first, so a missing
# or wrong input leaves the checkout as it was.
#
# OpenMono is licensed under the SIL Open Font License 1.1 (src/asset/fonts/OpenMono-OFL.txt).
# Run from services/site, after each font build:
#   uvx --from 'fonttools[woff]==4.60.1' python script/openmono.py path/to/app-nerd
import json
import shutil
import sys
import tempfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

source = Path("src/docs/assets/fonts")
out = Path("src/asset/fonts")
styles = {
    "regular": "Regular",
    "bold": "Bold",
    "italic": "Italic",
    "bold-italic": "BoldItalic",
}
latin = [(0x0000, 0x017F), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2500, 0x25FF)]
# The keys that shortcuts name (⌃ ⌘ ⌥ ⌫ ⎋ ⏎, as in Inter's Latin file), which are in the Latin file too: the
# search box on every page shows ⌘K, and from the "rest" file that one character would cost 123 kB.
keys = {0x2303, 0x2318, 0x2325, 0x232B, 0x238B, 0x23CE}
# Common symbols, in the Latin file too for the same reason. Each is one a terminal prints as a status
# mark, or one that a page of opencode.ai, its docs, the Console or opentui.com sets in mono:
symbols = {
    # ✓ ✗ ✕ ✖ ⚠: status marks (✓ is in opentui.com's docs and the Console's demos)
    *(0x2713, 0x2717, 0x2715, 0x2716, 0x26A0),
    # ∙ ⋅: the dots that two of opentui.com's terminal recordings draw
    *(0x2219, 0x22C5),
    # ≈ ≠ ≤ ≥ ∞ √ ∑: plain math (≈ is on /font, ∞ is the Console's unlimited allowance)
    *(0x2248, 0x2260, 0x2264, 0x2265, 0x221E, 0x221A, 0x2211),
    # ⋯ and the replacement character: in code on a changelog page
    *(0x22EF, 0xFFFD),
    # ⁰ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹, ₀ ₁ and σ: the numbers on /font (¹ ² ³ are in Latin-1). Σ too: the page sets its σ in capitals
    *(0x2070, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079, 0x2080, 0x2081, 0x03C3, 0x03A3),
}
cyrillic = [(0x0400, 0x052F), (0x1C80, 0x1C8F), (0x2DE0, 0x2DFF), (0xA640, 0xA69F)]
# The stress marks, which the Cyrillic file has too: a stressed letter such as у́ has no code point of
# its own, and a browser sets a letter and its mark from one file or falls back for both. (A Latin
# letter with one of them has a code point of its own, which the Latin file has.) The "rest" file has
# them too, so the Cyrillic rule must come after the rest rule in a stylesheet: a browser asks the
# last rule that has a character first, and a stressed Russian word then fetches the small file only.
stress = {0x0300, 0x0301}
# Blocks where the font has most characters or a few scattered ones, and the ones it lacks are
# unassigned or rare: Greek, Armenian, phonetic letters, superscripts, currency signs, letterlike
# and technical symbols, Latin Extended-D to G, double-struck letters and legacy computing symbols.
# There a range runs on across the code points the font lacks, up to one that another file has,
# which keeps the stylesheet within the docs' budget (src/docs/script/build.ts). The only cost is
# that a page using one of the lacking characters fetches the "rest" file before falling back. The
# ranges around the Powerline characters are exact, as in Desktop, whose icons file has the code
# points between them.
sparse = [
    (0x0370, 0x03FF),
    (0x0530, 0x058F),
    (0x1D00, 0x1DBF),
    (0x1F00, 0x1FFF),
    (0x2070, 0x209F),
    (0x20A0, 0x20CF),
    (0x2100, 0x214F),
    (0x2300, 0x23FF),
    (0xA720, 0xA7FF),
    (0xAB30, 0xAB6F),
    (0xF880, 0xF89F),
    (0x10780, 0x107BF),
    (0x1CC00, 0x1CEBF),
    (0x1D400, 0x1D7FF),
    (0x1DF00, 0x1DFFF),
    (0x1FB00, 0x1FBFF),
]
notice = """The openmono-*.woff2 files in this folder are subsets of OpenMono 1.000, made by
services/site/script/openmono.py from the app build (no ligatures, every
character one cell wide). OpenMono is Anomaly's typeface, built on Iosevka by
Renzhi Li (Belleve Invis). The font declares no Reserved Font Name.

"""


def within(code, spans):
    return any(a <= code <= b for a, b in spans)


def spans(codes, others=frozenset()):
    """The ranges of some characters: runs of code points, joined across a gap inside one sparse block unless a
    character of another file is in the gap."""
    found = []
    for code in sorted(codes):
        block = next((span for span in sparse if within(code, [span])), None)
        gap = range(found[-1][1] + 1, code) if found else range(0)
        if found and (not gap or (block and within(gap[0], [block]) and others.isdisjoint(gap))):
            found[-1][1] = code
            continue
        found.append([code, code])
    return found


def ranges(codes, others=frozenset()):
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans(codes, others))


build = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else None
inputs = {
    file: (build / "woff2" / f"OpenMonoNerd-{file}-text.woff2") if build else source / f"OpenMono-{file}.woff2"
    for file in styles.values()
}
licence = build / "LICENSE" if build else None
missing = [str(path) for path in [*inputs.values(), *([licence] if licence else [])] if not path.is_file()]
if missing:
    raise SystemExit("Nothing was written. Missing: " + ", ".join(missing))

with tempfile.TemporaryDirectory() as folder:
    staged = Path(folder)
    members = {}
    for name, file in styles.items():
        font = TTFont(inputs[file])
        wide = sorted(code for code, glyph in font.getBestCmap().items() if font["hmtx"][glyph][0] not in (0, 600))
        if wide:
            raise SystemExit(f"Nothing was written. {inputs[file]} is not the one-cell build: {ranges(wide)} are not 600 units wide")
        codes = set(font.getBestCmap())
        if (keys | symbols) - codes:
            raise SystemExit(f"Nothing was written. {inputs[file]} lacks {ranges((keys | symbols) - codes)}, which the Latin file is to have")
        groups = {
            "latin": {code for code in codes if within(code, latin) or code in keys | symbols},
            "cyrillic": {code for code in codes if within(code, cyrillic) or code in stress},
            "rest": {code for code in codes if not within(code, latin + cyrillic) and code not in keys | symbols},
        }
        for group, chars in groups.items():
            if members.setdefault(group, chars) != chars:
                raise SystemExit(f"Nothing was written. {inputs[file]} has other {group} characters than the styles before it: {ranges(members[group] ^ chars)}")
            options = subset.Options()
            options.flavor = "woff2"
            options.layout_features = ["ccmp", "locl", "mark", "mkmk"]
            options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
            options.notdef_outline = True
            options.hinting = False
            options.desubroutinize = True
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=chars)
            # The source's own timestamp, so a rebuild from the same files writes the same bytes.
            copy = TTFont(inputs[file], recalcTimestamp=False)
            subsetter.subset(copy)
            copy.flavor = "woff2"
            copy.save(staged / f"openmono-{name}-{group}.woff2")
    # A file's range may run across code points the font lacks, never across another file's characters.
    others = {group: frozenset().union(*(chars for other, chars in members.items() if other != group)) - members[group] for group in members}
    for group, chars in members.items():
        taken = sorted({code for a, b in spans(chars, others[group]) for code in range(a, b + 1)} & others[group])
        if taken:
            raise SystemExit(f"Nothing was written. The {group} range would take {ranges(taken)} from another file")
    (staged / "openmono.json").write_text(json.dumps({group: ranges(chars, others[group]) for group, chars in members.items()}, indent=2) + "\n")
    if licence:
        (staged / "OpenMono-OFL.txt").write_text(notice + licence.read_text())

    # Everything is built: replace the checkout's files.
    if build:
        source.mkdir(parents=True, exist_ok=True)
        for file, path in inputs.items():
            shutil.copyfile(path, source / f"OpenMono-{file}.woff2")
    for path in sorted(staged.iterdir()):
        shutil.copyfile(path, out / path.name)
        print(out / path.name, path.stat().st_size)
