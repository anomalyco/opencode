import { describe, expect, test } from "bun:test"
import { extensionPages } from "~/component/site/extension-data"

const browse = extensionPages.find((extension) => extension.slug === "browse")!

// The browse page (anomalyco/browse): the Chrome Web Store is the main action, the install leads
// with the extension and then lists the CLI commands, and the product name is always lowercase.
describe("browse", () => {
  test("is a product at /product/browse with the Chrome Web Store as its main action", () => {
    expect(browse.product).toBe(true)
    expect(browse.store).toBe("https://chromewebstore.google.com/detail/mfnicocicmmlkpjnaffgihfjhdgjkdjg")
    expect(browse.source).toBe("https://github.com/anomalyco/browse")
  })

  test("leads the install with the extension, then lists the standalone scripts first", () => {
    expect(browse.install.lead).toContain("[Chrome extension]")
    expect(browse.install.commands?.slice(0, 2)).toEqual([
      { method: "curl", command: "curl -fsSL https://opencode.ai/browse/install | bash" },
      { method: "pwsh", command: "irm https://opencode.ai/browse/install.ps1 | iex" },
    ])
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
