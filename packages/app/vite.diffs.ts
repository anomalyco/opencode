import { transform } from "lightningcss"
import type { Plugin } from "vite"

// iOS Safari 16.4, the same baseline as `build.cssTarget`, in Lightning CSS's encoding (major << 16 | minor << 8).
const safari = (16 << 16) | (4 << 8)

/**
 * `@pierre/diffs` ships its stylesheet as a JS string, which `build.cssTarget` does not reach. It uses `light-dark()`
 * for every diff color and nested rules, so Safari before 17.5 shows diffs without colors.
 *
 * Browsers without `light-dark()` get a copy lowered by Lightning CSS. Other browsers keep the original: the lowered copy
 * also turns `light-dark()` declarations that browsers reject (such as token backgrounds that fall back to `inherit`)
 * into ones that apply.
 */
export function diffsStyleFallback(): Plugin {
  return {
    name: "opencode-app:diffs-style-fallback",
    apply: "build",
    transform(code, id) {
      if (!id.endsWith("/@pierre/diffs/dist/style.js")) return
      const literal = code.match(/var style_default = ("(?:[^"\\]|\\.)*");/)?.[1]

      if (!literal)
        throw new Error("@pierre/diffs/dist/style.js no longer declares style_default; update vite.diffs.ts")

      const lowered = transform({
        filename: "diffs.css",
        // Token backgrounds fall back to `light-dark(inherit, inherit)`, which browsers reject, leaving them
        // transparent. Lowered, `inherit` would apply and repaint the line and word highlights behind every token.
        code: Buffer.from(
          String(JSON.parse(literal)).replaceAll(/(var\(--diffs-token-(?:light|dark)-bg,)inherit\)/g, "$1transparent)"),
        ),
        minify: true,
        targets: { safari, ios_saf: safari },
      }).code.toString()

      return code.replace(
        literal,
        () => `CSS.supports("color", "light-dark(#000, #fff)") ? ${literal} : ${JSON.stringify(lowered)}`,
      )
    },
  }
}
