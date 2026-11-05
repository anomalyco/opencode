# Builds the site's OpenTUI Mono files from the docs' copies (services/www/src/docs/assets/fonts,
# the same files as anomalyco/opentui packages/web/public/fonts). Two files per style, split by
# unicode-range like Inter: "latin" (Latin, punctuation, arrows, shapes and box drawing, what the
# site sets in mono) and "rest" (every other character the font has, only fetched when a page uses
# one). The ranges are written to src/asset/fonts/opentui-mono.json for mono-fonts.ts.
#
# The font draws arrows, the em dash, the ellipsis and the geometric shapes two cells wide; its NWID
# feature has one-cell versions. The cmap points at those, so every character advances 0.6 em (like
# the metric-matched fallbacks) and no CSS feature is needed. Only the layout features for accents
# are kept.
#
# OpenTUI Mono is licensed under the SIL Open Font License 1.1 (src/asset/fonts/OpenTUIMono-OFL.txt).
# Run from packages/console/app:
#   uvx --from 'fonttools[woff]==4.60.1' python script/opentui-mono.py
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

source = Path("../../../services/www/src/docs/assets/fonts")
out = Path("src/asset/fonts")
styles = {
    "regular": "OpenTUIMono-Regular",
    "bold": "OpenTUIMono-Bold",
    "italic": "OpenTUIMono-Italic",
    "bold-italic": "OpenTUIMono-BoldItalic",
}
# Left out of both files, so they set in the system font: the one-cell ⇧ is too narrow to read as
# the Shift key in shortcuts (⌘ and ⌥, its neighbours there, aren't in the font either).
excluded = {0x21E7}
latin = [(0x0000, 0x017F), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2500, 0x25FF)]


def narrow(font):
    gsub = font["GSUB"].table
    lookups = [
        gsub.LookupList.Lookup[index]
        for record in gsub.FeatureList.FeatureRecord
        if record.FeatureTag == "NWID"
        for index in record.Feature.LookupListIndex
    ]
    mapping = {a: b for lookup in lookups for table in lookup.SubTable for a, b in getattr(table, "mapping", {}).items()}
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap = {code: mapping.get(glyph, glyph) for code, glyph in table.cmap.items()}


def ranges(codes):
    spans = []
    for code in sorted(codes):
        if spans and spans[-1][1] == code - 1:
            spans[-1][1] = code
            continue
        spans.append([code, code])
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans)


written = {}
for name, file in styles.items():
    font = TTFont(source / f"{file}.woff2")
    narrow(font)
    codes = set(font.getBestCmap()) - excluded
    groups = {
        "latin": {code for code in codes if any(a <= code <= b for a, b in latin)},
        "rest": {code for code in codes if not any(a <= code <= b for a, b in latin)},
    }
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
        copy = TTFont(source / f"{file}.woff2")
        narrow(copy)
        subsetter.subset(copy)
        copy.flavor = "woff2"
        path = out / f"opentui-mono-{name}-{group}.woff2"
        copy.save(path)
        written[group] = ranges(members)
        print(path, path.stat().st_size)

(out / "opentui-mono.json").write_text(json.dumps(written, indent=2) + "\n")
