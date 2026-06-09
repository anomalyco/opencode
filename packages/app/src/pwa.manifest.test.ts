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
 *   - `theme_color` is "#F8F7F7"
 *     (aligned with the app's primary brand/background colour and consistent
 *      with the index.html meta theme-color)
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
  start_url?: string
  id?: string
  scope?: string
  description?: string
  screenshots?: Array<{ form_factor?: string }>
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

  test("at least one icon has purpose 'any'", () => {
    // The `purpose` field may be a space-separated list per the spec,
    // e.g. "any maskable". We split and check each token.
    const hasAnyPurpose = manifest.icons?.some((icon) => {
      const purposes = (icon.purpose ?? "").split(/\s+/).map((p) => p.toLowerCase())
      return purposes.includes("any")
    })
    expect(hasAnyPurpose).toBe(true)
  })

  test("theme_color is #F8F7F7 (consistent with index.html meta theme-color)", () => {
    expect(manifest.theme_color).toBe("#F8F7F7")
  })

  test("background_color is #F8F7F7 (aligned with theme_color)", () => {
    expect(manifest.background_color).toBe("#F8F7F7")
  })

  test("start_url is '/'", () => {
    expect(manifest.start_url).toBe("/")
  })

  test("id is '/' (PWA identity spec compliance)", () => {
    expect(manifest.id).toBe("/")
  })

  test("scope is '/'", () => {
    expect(manifest.scope).toBe("/")
  })

  test("screenshots has wide and narrow entries", () => {
    expect(manifest.screenshots).toBeDefined()
    expect(manifest.screenshots?.some((s) => s.form_factor === "wide")).toBe(true)
    expect(manifest.screenshots?.some((s) => s.form_factor === "narrow")).toBe(true)
  })

  test("description is set", () => {
    expect(manifest.description).toBeTruthy()
  })
})
