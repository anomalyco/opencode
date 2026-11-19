# Builds the site's OpenMono files. With the font build's folder as its argument (the "app-nerd" output
# of the OpenMono build, the files OpenCode Desktop bundles) it first copies woff2/OpenMonoNerd-<Style>-text.woff2
# and LICENSE from there into src/docs/assets/fonts (as OpenMono-<Style>.woff2) and
# src/asset/fonts/OpenMono-OFL.txt; without one it rebuilds from those copies. The copies are OpenMono 1.000.
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
# OpenMono is licensed under the SIL Open Font License 1.1 (src/asset/fonts/OpenMono-OFL.txt).
# Run from services/site, after each font build:
#   uvx --from 'fonttools[woff]==4.60.1' python script/openmono.py path/to/app-nerd
import json
import shutil
import sys
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
# Left out of both files, so they set in the system font: the one-cell ⇧ is too narrow to read as
# the Shift key in shortcuts (⌘ and ⌥, its neighbours there, aren't in the font either).
excluded = {0x21E7}
latin = [(0x0000, 0x017F), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2500, 0x25FF)]
cyrillic = [(0x0400, 0x052F), (0x1C80, 0x1C8F), (0x2DE0, 0x2DFF), (0xA640, 0xA69F)]
notice = """The openmono-*.woff2 files in this folder are subsets of OpenMono 1.000, made by
services/site/script/openmono.py from the app build (no ligatures, every
character one cell wide). OpenMono is Anomaly's typeface, built on Iosevka by
Belleve Invis. The font declares no Reserved Font Name.

"""


def ranges(codes):
    spans = []
    for code in sorted(codes):
        if spans and spans[-1][1] == code - 1:
            spans[-1][1] = code
            continue
        spans.append([code, code])
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans)


if len(sys.argv) > 1:
    build = Path(sys.argv[1]).expanduser()
    source.mkdir(parents=True, exist_ok=True)
    for file in styles.values():
        shutil.copyfile(build / "woff2" / f"OpenMonoNerd-{file}-text.woff2", source / f"OpenMono-{file}.woff2")
    (out / "OpenMono-OFL.txt").write_text(notice + (build / "LICENSE").read_text())

written = {}
for name, file in styles.items():
    font = TTFont(source / f"OpenMono-{file}.woff2")
    wide = sorted(code for code, glyph in font.getBestCmap().items() if font["hmtx"][glyph][0] not in (0, 600))
    if wide:
        raise SystemExit(f"OpenMono-{file}.woff2 is not the one-cell build: {ranges(wide)} are not 600 units wide")
    codes = set(font.getBestCmap()) - excluded
    groups = {
        "latin": {code for code in codes if any(a <= code <= b for a, b in latin)},
        "cyrillic": {code for code in codes if any(a <= code <= b for a, b in cyrillic)},
        "rest": {code for code in codes if not any(a <= code <= b for a, b in latin + cyrillic)},
    }
    if "italic" in name:
        del groups["cyrillic"]
    for group, members in groups.items():
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["ccmp", "locl", "mark", "mkmk"]
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6]
        options.notdef_outline = True
        options.hinting = False
        options.desubroutinize = True
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=members)
        # The source's own timestamp, so a rebuild from the same files writes the same bytes.
        copy = TTFont(source / f"OpenMono-{file}.woff2", recalcTimestamp=False)
        subsetter.subset(copy)
        copy.flavor = "woff2"
        path = out / f"openmono-{name}-{group}.woff2"
        copy.save(path)
        if written.setdefault(group, ranges(members)) != ranges(members):
            raise SystemExit(f"OpenMono-{file}.woff2 has other {group} characters than the styles before it")
        print(path, path.stat().st_size)

(out / "openmono.json").write_text(json.dumps(written, indent=2) + "\n")
