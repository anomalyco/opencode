# Builds the app's OpenMono files from the app build of OpenMono Nerd (the "app-nerd" output of the OpenMono build,
# which has no ligatures and every character one cell wide). Run from packages/app after each font build:
#
#   uvx --from 'fonttools[woff]==4.60.1' python script/openmono.py <app-nerd build folder>
#
# The build has a `-text` WOFF2 file per style (every text character, box drawing, blocks and the terminal
# interface's symbols) and an `-icons` file (the Nerd Fonts icons). The script writes, to src/assets/fonts:
#
# - three files per style, split by unicode-range so that the app loads a small file with the shell and the others
#   only when a character of theirs is drawn: "latin" (Latin, punctuation, arrows, shapes, box drawing and a few
#   keys and common symbols), "cyrillic" and "rest" (every other character the font has);
# - the Regular build's icons file, once, for all styles: the icons are the same in every style.
#
# The split is the websites' (services/site/script/openmono.py): the same Latin and Cyrillic blocks, the same keys
# and symbols in the Latin file, the stress marks in the Cyrillic file too, and the same subsetting options, which
# keep only the layout features for accents. Both scripts make the same files, byte for byte, and the text rules in
# src/index.css have the unicode-range values of the websites' openmono.json. Keep the lists below the same as theirs.
#
# Every input is read and checked and every file is built in a temporary folder first, so a build that is incomplete
# or does not match the @font-face rules in src/index.css leaves the checkout as it was. The same input files give
# the same bytes.
#
# OpenMono is licensed under the SIL Open Font License 1.1 (public/assets/OpenMono-OFL.txt).
import re
import shutil
import sys
import tempfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

app = Path(__file__).resolve().parent.parent
out = app / "src/assets/fonts"
styles = ["Regular", "Bold", "Italic"]
latin = [(0x0000, 0x017F), (0x2000, 0x206F), (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2190, 0x21FF), (0x2212, 0x2212), (0x2500, 0x25FF)]
# The keys that shortcuts name (⌃ ⌘ ⌥ ⌫ ⎋ ⏎), which are in the Latin file too, as on the websites: a hint such as
# ⌘K set in the code font would otherwise load the "rest" file for one character.
keys = {0x2303, 0x2318, 0x2325, 0x232B, 0x238B, 0x23CE}
# Common symbols, in the Latin file too for the same reason. Each is one a terminal prints as a status mark, or one
# that a page of the websites sets in mono:
symbols = {
    # ✓ ✗ ✕ ✖ ⚠: status marks
    *(0x2713, 0x2717, 0x2715, 0x2716, 0x26A0),
    # ∙ ⋅: the dots that terminal programs draw
    *(0x2219, 0x22C5),
    # ≈ ≠ ≤ ≥ ∞ √ ∑: plain math
    *(0x2248, 0x2260, 0x2264, 0x2265, 0x221E, 0x221A, 0x2211),
    # ⋯ and the replacement character
    *(0x22EF, 0xFFFD),
    # ⁰ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹, ₀ ₁, σ and Σ (¹ ² ³ are in Latin-1)
    *(0x2070, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079, 0x2080, 0x2081, 0x03C3, 0x03A3),
    # The OpenCode logo (OpenMono 1.001), set in Latin text
    0x10C0DE,
}
cyrillic = [(0x0400, 0x052F), (0x1C80, 0x1C8F), (0x2DE0, 0x2DFF), (0xA640, 0xA69F)]
# The stress marks, which the Cyrillic file has too: a stressed letter such as у́ has no code point of its own, and a
# browser sets a letter and its mark from one file or falls back for both. (A Latin letter with one of them has a
# code point of its own, which the Latin file has.) The "rest" file has them too, so the Cyrillic rule must come
# after the "rest" rule in src/index.css: a browser asks the last rule that has a character first, and a stressed
# Russian word then loads the small file only.
stress = {0x0300, 0x0301}
# Blocks where the font has most characters or a few scattered ones, and the ones it lacks are unassigned or rare:
# Greek, Armenian, phonetic letters, superscripts, currency signs, letterlike and technical symbols, Latin Extended-D
# to G, double-struck letters and legacy computing symbols. There a range runs on across the code points the font
# lacks, up to one that another text file has, which keeps the stylesheet short. The "rest" range so runs across four
# code points of the icons file (U+23FB-23FE): the icons rules come after the text rules in src/index.css, so a
# browser asks the icons file for those.
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
notice = """The OpenMono-*.woff2 files of this app are subsets of OpenMono 1.001, made by
packages/app/script/openmono.py from the app build (no ligatures, every
character one cell wide). OpenMono is Anomaly's typeface, built on Iosevka by
Renzhi Li (Belleve Invis).

"""


def stop(reason, details=()):
    raise SystemExit("\n".join(["Nothing was written. " + reason, *details]))


def within(code, spans):
    return any(a <= code <= b for a, b in spans)


def spans(codes, others=None):
    """The ranges of some characters: runs of code points. Given the characters of the other files, a range for a
    stylesheet: the runs are joined across a gap inside one sparse block unless one of those characters is in it."""
    found = []
    for code in sorted(codes):
        block = next((span for span in sparse if within(code, [span])), None)
        gap = range(found[-1][1] + 1, code) if found else range(0)
        if found and (not gap or (others is not None and block and within(gap[0], [block]) and others.isdisjoint(gap))):
            found[-1][1] = code
            continue
        found.append([code, code])
    return found


def ranges(codes, others=None):
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in spans(codes, others))


def drawn(path):
    """What an icons file draws: its code points, and the outline and horizontal metrics of every glyph but
    .notdef, the first one, which each style draws its own way and no character uses."""
    font = TTFont(path)
    return {
        "code points": font.getBestCmap(),
        "outlines": font.getTableData("glyf")[font["loca"][1] :],
        "horizontal metrics": font.getTableData("hmtx")[4:],
    }


if len(sys.argv) != 2:
    raise SystemExit("Usage: uvx --from 'fonttools[woff]==4.60.1' python script/openmono.py <app-nerd build folder>")
build = Path(sys.argv[1]).expanduser()
texts = {style: build / "woff2" / f"OpenMonoNerd-{style}-text.woff2" for style in styles}
# The bundled styles' icons files, and those of any other style the build has.
icons = sorted({build / "woff2" / f"OpenMonoNerd-{style}-icons.woff2" for style in styles} | set((build / "woff2").glob("OpenMonoNerd-*-icons.woff2")))
licence = build / "LICENSE"
missing = [str(path) for path in [*texts.values(), *icons, licence] if not path.is_file()]
if missing:
    stop("The build is not complete. Missing:", missing)

# One icons file serves every style only while each style's file draws the same icons.
regular = build / "woff2" / "OpenMonoNerd-Regular-icons.woff2"
reference = drawn(regular)
different = [f"{path.name}: the {part} differ from {regular.name}" for path in icons for part, value in drawn(path).items() if value != reference[part]]
if different:
    stop(
        "The icons files of this build are not the same in every style, so one file cannot serve all of them:",
        [*different, "Bundle an icons file per style (script/openmono.py and src/index.css) to use this build."],
    )

with tempfile.TemporaryDirectory() as folder:
    staged = Path(folder)
    members = {}
    for style, path in texts.items():
        font = TTFont(path)
        wide = sorted(code for code, glyph in font.getBestCmap().items() if font["hmtx"][glyph][0] not in (0, 600))
        if wide:
            stop(f"{path} is not the one-cell build: {ranges(wide)} are not 600 units wide")
        codes = set(font.getBestCmap())
        if (keys | symbols) - codes:
            stop(f"{path} lacks {ranges((keys | symbols) - codes)}, which the Latin file is to have")
        groups = {
            "latin": {code for code in codes if within(code, latin) or code in keys | symbols},
            "rest": {code for code in codes if not within(code, latin + cyrillic) and code not in keys | symbols},
            "cyrillic": {code for code in codes if within(code, cyrillic) or code in stress},
        }
        for group, chars in groups.items():
            if members.setdefault(group, chars) != chars:
                stop(f"{path} has other {group} characters than the styles before it: {ranges(members[group] ^ chars)}")
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
            copy = TTFont(path, recalcTimestamp=False)
            subsetter.subset(copy)
            copy.flavor = "woff2"
            copy.save(staged / f"OpenMono-{style}-{group}.woff2")
    # The range to write in a file's rule. A text file's range is the websites': it may run across code points the
    # font lacks, never across another text file's characters.
    letters = frozenset().union(*members.values())
    wanted = {group: ranges(chars, letters - chars) for group, chars in members.items()}
    shutil.copyfile(regular, staged / "OpenMono-icons.woff2")
    members["icons"] = set(reference["code points"])
    wanted["icons"] = ranges(members["icons"], letters)

    # Each @font-face rule of the family in src/index.css, in the stylesheet's order: the file it names, its style
    # and the code points of its unicode-range.
    rules = []
    for body in re.findall(r"@font-face\s*{([^}]*)}", (app / "src/index.css").read_text()):
        value = {name: " ".join(text.split()) for name, text in re.findall(r"([\w-]+)\s*:([^;]*);", body)}
        file = re.search(r"OpenMono-[\w-]+\.woff2", value.get("src", ""))
        if not file:
            continue
        covered = set()
        for part in value.get("unicode-range", "U+0-10FFFF").split(","):
            first, _, last = part.strip()[2:].partition("-")
            covered.update(range(int(first, 16), int(last or first, 16) + 1))
        rules.append({"file": file.group(0), "style": f'{value.get("font-weight")} {value.get("font-style")}', "range": covered})

    # A character must be in the range of the rule that names its file, or the browser never asks that file for it.
    # It may be in another rule of the same style only when that rule's file has it too (the stress marks), or when
    # its own rule comes later, because the browser asks the last rule that has a character first.
    wrong = []
    for style in styles:
        named = {group: next((rule for rule in rules if rule["file"] == f"OpenMono-{style}-{group}.woff2"), None) for group in ["latin", "rest", "cyrillic"]}
        text = next((rule for rule in named.values() if rule), None)
        named["icons"] = text and next((rule for rule in rules if rule["file"] == "OpenMono-icons.woff2" and rule["style"] == text["style"]), None)
        for group, rule in named.items():
            file = "OpenMono-icons.woff2" if group == "icons" else f"OpenMono-{style}-{group}.woff2"
            if not rule or rule["style"] != text["style"]:
                wrong.append(f"{file}: no @font-face rule with the style of the {style} text rules. Its range is\n  unicode-range: {wanted[group]};")
                continue
            outside = members[group] - rule["range"]
            taken = {
                other: rule["range"] & members[other] - members[group]
                for other in named
                if other != group and not (named[other] and rules.index(named[other]) > rules.index(rule))
            }
            if outside:
                wrong.append(f"{file} ({style}): {ranges(outside)} are not in the unicode-range of its rule. Its range is\n  unicode-range: {wanted[group]};")
            wrong.extend(
                f"{file} ({style}): its rule's unicode-range takes {ranges(codes)} from the {other} file, whose rule does not come after it. Its range is\n  unicode-range: {wanted[group]};"
                for other, codes in taken.items()
                if codes
            )
    if wrong:
        stop("The @font-face rules in src/index.css do not match the characters of this build:", wrong)

    text = licence.read_text()
    notices = (app / "src/settings/about/notices/notices.ts").read_text()
    uncredited = [line for line in text.splitlines() if line.startswith("Copyright (c)") and line not in notices]
    if uncredited:
        stop("src/settings/about/notices/notices.ts does not have these copyright lines of the build's license:", uncredited)
    (staged / "OpenMono-OFL.txt").write_text(notice + text)

    # Everything is built and checked: replace the checkout's files.
    out.mkdir(parents=True, exist_ok=True)
    for path in sorted(staged.iterdir()):
        target = app / "public/assets" / path.name if path.suffix == ".txt" else out / path.name
        shutil.copyfile(path, target)
        print(target.relative_to(app), path.stat().st_size)
    print(f"{len(icons)} icons files hold the same {len(members['icons'])} icons; every character is in its own rule's range")
