import assert from "node:assert/strict"
import { migrateV1, resolveThemeDocument } from "../packages/theme/src/tui/index.js"
import { createColors, deriveInactiveColor, deriveTrailColors } from "../packages/tui/src/ui/spinner.js"

const document = migrateV1(
  await Bun.file(new URL("../packages/tui/src/theme/assets/opencode.json", import.meta.url)).json(),
)

for (const mode of ["light", "dark"] as const) {
  const color = resolveThemeDocument(document, mode).hue.accent[800]
  const trail = deriveTrailColors(color)
  const head = trail[0]
  assert.ok(head)
  assert.deepEqual([head.r, head.g, head.b, head.a], [color.r, color.g, color.b, 1])

  const inactive = deriveInactiveColor(color, 0.25)
  assert.deepEqual([inactive.r, inactive.g, inactive.b], [color.r, color.g, color.b])
  assert.ok(Math.abs(inactive.a - 0.25) <= 1 / 255)

  const animated = createColors({ colors: trail, defaultColor: color })(0, 0, 15, 8)
  assert.ok(typeof animated !== "string")
  assert.deepEqual([animated.r, animated.g, animated.b, animated.a], [color.r, color.g, color.b, 1])
  console.log(`${mode}: theme colors retain their channels through all spinner conversions`)
}
