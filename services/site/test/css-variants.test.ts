import { expect, test } from "bun:test"
import { cssVariants } from "~/component/site/css-variants"
import variants from "~/component/site/css-variants.json"

// The production build drops CSS for every settings value but these (vite.config.ts), so they must
// be what production renders. Regenerate with `bun script/css-variants.ts`.
test("css-variants.json matches the default settings", () => {
  expect(variants as Record<string, string | null>).toEqual(cssVariants())
})
