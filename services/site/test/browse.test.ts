import { describe, expect, test } from "bun:test"
import { extensionPages } from "~/component/site/extension-data"

const browse = extensionPages.find((extension) => extension.slug === "browse")!

// The browse page (anomalyco/browse): the Chrome Web Store is the main action, the standalone
// installer is the command, and the product name is always lowercase.
describe("browse", () => {
  test("is a product at /browse with the Chrome Web Store as its main action", () => {
    expect(browse.product).toBe(true)
    expect(browse.store).toBe("https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg")
    expect(browse.source).toBe("https://github.com/anomalyco/browse")
  })

  test("installs from the standalone script, with no Node.js requirement", () => {
    expect(browse.install.command).toBe("curl -fsSL https://opencode.ai/browse/install | bash")
    expect(browse.install.lead).toContain("https://opencode.ai/browse/install.ps1")
    expect(browse.install.lead).not.toMatch(/node\.?js|npx/i)
  })

  test("keeps the documented title and description lengths", () => {
    expect(browse.title.length).toBeGreaterThanOrEqual(50)
    expect(browse.title.length).toBeLessThanOrEqual(60)
    expect(browse.description.length).toBeGreaterThanOrEqual(120)
    expect(browse.description.length).toBeLessThanOrEqual(160)
  })

  test("keeps the product name Browse", () => {
    expect(browse.name).toBe("Browse")
    const copy = [browse.body, browse.intro, ...browse.features.flatMap((feature) => [feature.title, feature.body])]
    expect(copy.some((line) => line.includes("—"))).toBe(false)
    expect(copy.some((line) => /deadbolt/i.test(line))).toBe(false)
  })
})
