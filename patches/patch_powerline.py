"""
Post-install patch for ghostty-web's compiled CanvasRenderer.

Three fixes are injected:

1. renderPowerlineGlyph()
   The bundled font's PUA powerline glyphs (U+E0B0..U+E0B6) render at
   font ascent/descent metrics, which are noticeably shorter than the cell
   box. We replace the font fillText call for those codepoints with hand-
   drawn vector triangles/curves filling the entire cell rect, so the
   chevrons match cell background extents exactly.

2. Cell metrics use fontBoundingBox* instead of actualBoundingBox*
   The original measureFont() derives metrics.height from
   actualBoundingBoxAscent/Descent of "Mg", i.e. the pixel bounding box of
   that exact string. That's just the rendered M and g extents and omits
   the font's designed leading. Cell backgrounds + powerline glyphs draw
   at metrics.height, so the colored prompt segments end up looking
   "topped" relative to native terminals (wezterm/iterm) that use the em
   box. We prefer fontBoundingBoxAscent/Descent first; the font-designed
   ascent/descent restores the missing breathing room above and below
   text without changing any other layout assumption.

3. Extra vertical padding around each cell
   On top of the font box, add CELL_PAD_TOP px above and CELL_PAD_BOTTOM
   px below every cell. This expands the colored prompt segments visually
   without affecting per-row character placement (the baseline shifts
   down by CELL_PAD_TOP so text stays centered relative to its row).

Idempotent: the patch is a no-op if renderPowerlineGlyph already exists.
"""

import sys

# Tweakable: extra pixels added to each cell's ascent and descent. 2/2
# matches the visual breathing room of native macOS terminals at 14px.
CELL_PAD_TOP = 2
CELL_PAD_BOTTOM = 2

if len(sys.argv) < 2:
    print("usage: patch_powerline.py <path-to-ghostty-web.js>", file=sys.stderr)
    sys.exit(1)

path = sys.argv[1]
with open(path, "r") as f:
    src = f.read()

PAD_MARKER = f"/* opencode-pad {CELL_PAD_TOP}/{CELL_PAD_BOTTOM} */"
if "renderPowerlineGlyph" in src and PAD_MARKER in src:
    print("already patched, skipping")
    sys.exit(0)

# -----------------------------------------------------------------------------
# Patch 1: prefer fontBoundingBox* over actualBoundingBox* in measureFont()
# -----------------------------------------------------------------------------

old_metrics = (
    "s = w.actualBoundingBoxAscent || w.fontBoundingBoxAscent || "
    "C.actualBoundingBoxAscent || g.actualBoundingBoxAscent || this.fontSize * 0.8, "
    "h = w.actualBoundingBoxDescent || w.fontBoundingBoxDescent || "
    "C.actualBoundingBoxDescent || g.actualBoundingBoxDescent || this.fontSize * 0.2"
)
new_metrics = (
    "s = w.fontBoundingBoxAscent || w.actualBoundingBoxAscent || "
    "C.fontBoundingBoxAscent || C.actualBoundingBoxAscent || g.actualBoundingBoxAscent || this.fontSize * 0.8, "
    "h = w.fontBoundingBoxDescent || w.actualBoundingBoxDescent || "
    "C.fontBoundingBoxDescent || C.actualBoundingBoxDescent || g.actualBoundingBoxDescent || this.fontSize * 0.2"
)

if old_metrics in src:
    src = src.replace(old_metrics, new_metrics, 1)
    print("patched measureFont metrics to prefer fontBoundingBox*")
elif new_metrics not in src:
    print("ERROR: could not find original measureFont metrics line", file=sys.stderr)
    sys.exit(1)

# -----------------------------------------------------------------------------
# Patch 3: add per-cell vertical padding via Math.ceil(...) bumps
# -----------------------------------------------------------------------------

old_ceil = "k = Math.ceil(s), N = Math.ceil(h), t = k + N;"
new_ceil = (
    f"k = Math.ceil(s) + {CELL_PAD_TOP} {PAD_MARKER}, "
    f"N = Math.ceil(h) + {CELL_PAD_BOTTOM}, "
    f"t = k + N;"
)

if old_ceil in src:
    src = src.replace(old_ceil, new_ceil, 1)
    print(f"added cell padding: top={CELL_PAD_TOP} bottom={CELL_PAD_BOTTOM}")
elif PAD_MARKER not in src:
    print("ERROR: could not find ceil/sum line", file=sys.stderr)
    sys.exit(1)

# -----------------------------------------------------------------------------
# Patch 2: inject renderPowerlineGlyph + dispatch in renderCellText
# -----------------------------------------------------------------------------

lines = src.splitlines(keepends=True)

powerline_method = """  renderPowerlineGlyph(cp, x, y, w, h) {
    const c = this.ctx;
    switch (cp) {
      case 57520:
        c.beginPath(), c.moveTo(x, y), c.lineTo(x + w, y + h / 2), c.lineTo(x, y + h), c.closePath(), c.fill();
        return !0;
      case 57522:
        c.beginPath(), c.moveTo(x + w, y), c.lineTo(x, y + h / 2), c.lineTo(x + w, y + h), c.closePath(), c.fill();
        return !0;
      case 57521:
        c.beginPath(), c.moveTo(x, y), c.lineTo(x + w, y + h / 2), c.lineTo(x, y + h), c.lineWidth = 1, c.strokeStyle = c.fillStyle, c.stroke();
        return !0;
      case 57523:
        c.beginPath(), c.moveTo(x + w, y), c.lineTo(x, y + h / 2), c.lineTo(x + w, y + h), c.lineWidth = 1, c.strokeStyle = c.fillStyle, c.stroke();
        return !0;
      case 57524:
        c.beginPath(), c.moveTo(x, y), c.quadraticCurveTo(x + w, y, x + w, y + h / 2), c.quadraticCurveTo(x + w, y + h, x, y + h), c.closePath(), c.fill();
        return !0;
      case 57526:
        c.beginPath(), c.moveTo(x + w, y), c.quadraticCurveTo(x, y, x, y + h / 2), c.quadraticCurveTo(x, y + h, x + w, y + h), c.closePath(), c.fill();
        return !0;
      default:
        return !1;
    }
  }
"""

if "renderPowerlineGlyph" not in src:
    # Find the renderCellText comment header to anchor the insertion.
    target = None
    for i, line in enumerate(lines):
        if "renderCellText(" in line and target is None:
            # Walk back to the /** comment block start.
            j = i
            while j > 0 and "/**" not in lines[j]:
                j -= 1
            target = j
            break

    if target is None:
        print("ERROR: could not locate renderCellText anchor", file=sys.stderr)
        sys.exit(1)

    lines.insert(target, powerline_method)
    print(f"injected renderPowerlineGlyph at line {target + 1}")

    # Now find the renderCellText body where text is composed and dispatch
    # powerline codepoints before fillText.
    target_line = None
    for i, line in enumerate(lines):
        if "const s = C, h = I + this.metrics.baseline;" in line and i > target:
            target_line = i
            break

    if target_line is None:
        print("ERROR: could not locate renderCellText body anchor", file=sys.stderr)
        sys.exit(1)

    print(f"dispatching powerline codepoints before fillText at line {target_line + 1}")
    lines[target_line] = "    const s = C, h = I + this.metrics.baseline;\n"
    lines.insert(target_line + 1, "    const cp = A.codepoint || 0;\n")
    lines.insert(
        target_line + 2,
        "    if (cp >= 57520 && cp <= 57526 && this.renderPowerlineGlyph(cp, C, I, D, this.metrics.height)) {\n",
    )
    lines.insert(target_line + 3, "      A.flags & G.FAINT && (this.ctx.globalAlpha = 1);\n")
    lines.insert(target_line + 4, "      return;\n")
    lines.insert(target_line + 5, "    }\n")

with open(path, "w") as f:
    f.writelines(lines)

print("done")
