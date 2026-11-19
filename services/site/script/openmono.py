# Builds the site's OpenMono files. With the font build's folder as its argument (the "app-nerd" output
# of the OpenMono build, whose Regular, Bold and Italic OpenCode Desktop bundles too) it reads
# woff2/OpenMonoNerd-<Style>-text.woff2 and LICENSE from there and also writes them to
# src/docs/assets/fonts (as OpenMono-<Style>.woff2) and src/asset/fonts/OpenMono-OFL.txt; without one it
# rebuilds from those copies. The copies are OpenMono 1.000.
#
# The files are split by unicode-range like Inter: "latin" (Latin, punctuation, arrows, shapes and box
# drawing, what the site sets in mono), "cyrillic" (the Russian and Ukrainian pages, and those
# languages' names in a language menu) and "rest" (every other character the font has), each only
# fetched when a page uses one of its characters. Regular and bold have all three; the italics have no
# Cyrillic file, since no page sets Cyrillic in mono italic and its two faces would put the docs'
# stylesheet over its budget (src/docs/script/build.ts). The ranges are written to
# src/asset/fonts/openmono.json for mono-fonts.ts; if they change, write them into src/style/fonts.css
# too (test/fonts.test.ts compares the two). packages/data/app serves copies of the regular and bold
# files; refresh them too.
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
# Left out of every file, so they set in the system font: the one-cell ⇧ is too narrow to read as
# the Shift key in shortcuts (⌘ and ⌥, its neighbours there, aren't in the font either).
excluded = {0x21E7}
latin = [(0x0000, 0x017F), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2500, 0x25FF)]
cyrillic = [(0x0400, 0x052F), (0x1C80, 0x1C8F), (0x2DE0, 0x2DFF), (0xA640, 0xA69F)]
# The stress marks, which the Cyrillic file has too: a stressed letter such as у́ has no code point of
# its own, and a browser sets a letter and its mark from one file or falls back for both. (A Latin
# letter with one of them has a code point of its own, which the Latin file has.)
stress = {0x0300, 0x0301}
# Blocks of rare letters and symbols (phonetic letters, Latin Extended-D to G, powerline and legacy
# computing symbols) where the font has a few scattered characters. There a range runs from the
# first to the last one, which keeps the stylesheet short: no other file serves the code points
# between them, so the only cost is that a page using one fetches the "rest" file before falling back.
sparse = [(0x1D00, 0x1DBF), (0xA720, 0xA7FF), (0xAB30, 0xAB6F), (0xE0B0, 0xE0BF), (0xF880, 0xF89F), (0x10780, 0x107BF), (0x1CC00, 0x1CEBF), (0x1DF00, 0x1DFFF), (0x1FB00, 0x1FBFF)]
notice = """The openmono-*.woff2 files in this folder are subsets of OpenMono 1.000, made by
services/site/script/openmono.py from the app build (no ligatures, every
character one cell wide). OpenMono is Anomaly's typeface, built on Iosevka by
Belleve Invis. The font declares no Reserved Font Name.

"""


def within(code, spans):
    return any(a <= code <= b for a, b in spans)


def spans(codes):
    found = []
    for code in sorted(codes):
        block = next((span for span in sparse if within(code, [span])), None)
        if found and (found[-1][1] == code - 1 or (block and within(found[-1][1], [block]))):
            found[-1][1] = code
            continue
        found.append([code, code])
    return found


def ranges(codes):
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans(codes))


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
        codes = set(font.getBestCmap()) - excluded
        groups = {
            "latin": {code for code in codes if within(code, latin)},
            "cyrillic": {code for code in codes if within(code, cyrillic) or code in stress},
            "rest": {code for code in codes if not within(code, latin + cyrillic)},
        }
        if "italic" in name:
            del groups["cyrillic"]
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
    # A wider range must not take a character from another file.
    for group, chars in members.items():
        added = {code for a, b in spans(chars) for code in range(a, b + 1)} - chars
        taken = sorted(code for other, others in members.items() if other != group for code in added & others)
        if taken:
            raise SystemExit(f"Nothing was written. The {group} range would take {ranges(taken)} from another file")
    (staged / "openmono.json").write_text(json.dumps({group: ranges(chars) for group, chars in members.items()}, indent=2) + "\n")
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
