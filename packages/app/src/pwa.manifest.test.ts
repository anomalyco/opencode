/**
 * @spec-handoff
 * @interface site.webmanifest (static JSON file)
 *   File: packages/app/public/site.webmanifest
 *   Consumed by the browser when the app is installed as a PWA.
 *
 * @behavior
 *   - `name` is "OpenCode"
 *   - `display` is "standalone" (required for installability)
 *   - At least one icon entry has `purpose` containing "any"
 *     (browsers require an "any" icon for the install prompt and splash screen;
 *      currently ALL icons are "maskable" only — this is the missing entry)
 *   - `theme_color` is NOT "#ffffff"
 *     (white conflicts with the dark-themed app shell and causes a jarring
 *      flash in browsers that honour theme_color for the title bar; the fix
 *      should align it with the app's primary brand/background colour)
 *
 * @edge-cases
 *   - `purpose` field may be a space-separated list: "any maskable" is valid
 *   - `icons` array must not be empty
 *   - `theme_color` must be a valid CSS colour string after the fix
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/Manifest
 * @see packages/app/public/site.webmanifest
 */

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// ---------------------------------------------------------------------------
// Load the manifest from disk — resolve relative to this source file so the
// test works regardless of where `bun test` is invoked from.
// ---------------------------------------------------------------------------
const manifestPath = join(import.meta.dir, "../public/site.webmanifest")

type ManifestIcon = {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

type WebManifest = {
  name?: string
  short_name?: string
  display?: string
  theme_color?: string
  background_color?: string
  icons?: ManifestIcon[]
}

const manifest: WebManifest = await Bun.file(manifestPath).json()

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("site.webmanifest", () => {
  test("name is 'OpenCode'", () => {
    expect(manifest.name).toBe("OpenCode")
  })

  test("display is 'standalone'", () => {
    expect(manifest.display).toBe("standalone")
  })

  test("at least one icon has purpose 'any' (currently missing — fails until E5)", () => {
    // The `purpose` field may be a space-separated list per the spec,
    // e.g. "any maskable". We split and check each token.
    const hasAnyPurpose = manifest.icons?.some((icon) => {
      const purposes = (icon.purpose ?? "").split(/\s+/).map((p) => p.toLowerCase())
      return purposes.includes("any")
    })
    expect(hasAnyPurpose).toBe(true)
  })

  test("theme_color is not '#ffffff' (inconsistency fix — fails until E5)", () => {
    // #ffffff is visually inconsistent with the dark app shell.
    // After the fix this should match the app's primary brand colour.
    expect(manifest.theme_color?.toLowerCase()).not.toBe("#ffffff")
  })
})
