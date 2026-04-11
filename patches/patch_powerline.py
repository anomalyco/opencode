import sys

path = sys.argv[1]
with open(path, 'r') as f:
    lines = f.readlines()

# Find the renderCellText method and inject renderPowerlineGlyph before it
# Line 1825 (0-indexed: 1824) is "  /**" before renderCellText
# Line 1829 (0-indexed: 1828) is "  renderCellText(A, Q, E, g) {"

powerline_method = '''  renderPowerlineGlyph(cp, x, y, w, h) {
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
'''

# Insert renderPowerlineGlyph method at line 1825 (before the /** comment)
insert_idx = 1824  # 0-indexed line 1825
lines.insert(insert_idx, powerline_method)

# Now find the renderCellText body - it shifted by the number of inserted lines
# Original line 1845: "    const s = C, h = I + this.metrics.baseline;"
# Original line 1846-1847: the fillText block
# We need to find and replace the section starting with "const s = C, h = I"

# Find the line with "const s = C, h = I + this.metrics.baseline;"
target_line = None
for i, line in enumerate(lines):
    if 'const s = C, h = I + this.metrics.baseline;' in line and i > insert_idx:
        target_line = i
        break

if target_line is None:
    print("ERROR: Could not find target line")
    sys.exit(1)

print(f"Found target at line {target_line + 1}")

# Replace that line and the next line (the fillText block)
old_next = lines[target_line + 1]
print(f"Old line {target_line + 1}: {lines[target_line].rstrip()}")
print(f"Old line {target_line + 2}: {old_next.rstrip()}")

# New content: add powerline check between setting baseline coords and fillText
lines[target_line] = '    const s = C, h = I + this.metrics.baseline;\n'
lines.insert(target_line + 1, '    const cp = A.codepoint || 0;\n')
lines.insert(target_line + 2, '    if (cp >= 57520 && cp <= 57526 && this.renderPowerlineGlyph(cp, C, I, D, this.metrics.height)) {\n')
lines.insert(target_line + 3, '      A.flags & G.FAINT && (this.ctx.globalAlpha = 1);\n')
lines.insert(target_line + 4, '      return;\n')
lines.insert(target_line + 5, '    }\n')

with open(path, 'w') as f:
    f.writelines(lines)

print("Done! Powerline glyph rendering injected successfully.")
