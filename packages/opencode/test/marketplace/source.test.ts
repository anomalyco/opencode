import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { describe, expect, test } from "bun:test"
import { resolveMarketplaceSourceReference } from "@/marketplace/source"

describe("marketplace local source references", () => {
  test("normalizes files, directories, relative paths, and file URLs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-marketplace-source-"))
    try {
      const catalog = path.join(root, "marketplace.json")
      const directory = path.join(root, "team")
      await fs.writeFile(catalog, "{}")
      await fs.mkdir(directory)

      const file = await resolveMarketplaceSourceReference(catalog)
      expect(file.local).toBe(true)
      expect(file.reference).toBe(catalog)
      expect(fileURLToPath(file.url)).toBe(catalog)

      const dir = await resolveMarketplaceSourceReference(directory)
      expect(dir.local).toBe(true)
      expect(dir.url.endsWith("/")).toBe(true)
      expect(fileURLToPath(dir.url)).toBe(`${directory}${path.sep}`)

      const relative = await resolveMarketplaceSourceReference("./marketplace.json", root)
      expect(fileURLToPath(relative.url)).toBe(catalog)

      const fileURL = pathToFileURL(catalog).href
      const fromURL = await resolveMarketplaceSourceReference(fileURL)
      expect(fileURLToPath(fromURL.url)).toBe(catalog)

      const fromUppercaseURL = await resolveMarketplaceSourceReference(fileURL.replace(/^file:/, "FILE:"))
      expect(fileURLToPath(fromUppercaseURL.url)).toBe(catalog)

      const remote = await resolveMarketplaceSourceReference("https://example.test/marketplace.json")
      expect(remote).toEqual({
        url: "https://example.test/marketplace.json",
        reference: "https://example.test/marketplace.json",
        local: false,
      })
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
