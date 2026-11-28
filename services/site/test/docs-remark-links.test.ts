import { expect, test } from "bun:test"
import remarkDocsLinks, { docsLink, type DocsLinks } from "../src/docs/remark-links"

const options: DocsLinks = {
  base: "/zh/docs",
  setBase: "/docs",
  pages: new Set(["index", "config", "build", "build/plugins", "api"]),
  files: ["assets", "openapi.json", "llms.txt"],
}

test("docs pages take the page's language", () => {
  expect(docsLink("/config", options)).toBe("/zh/docs/config")
  expect(docsLink("/build/plugins/", options)).toBe("/zh/docs/build/plugins/")
  expect(docsLink("/build/plugins#server", options)).toBe("/zh/docs/build/plugins#server")
  expect(docsLink("/", options)).toBe("/zh/docs/")
})

test("docs files stay under the English set base, and other paths are left alone", () => {
  expect(docsLink("/assets/anomaly-w9.pdf", options)).toBe("/docs/assets/anomaly-w9.pdf")
  expect(docsLink("/openapi.json", options)).toBe("/docs/openapi.json")
  for (const url of ["/pricing", "/docs/assets/anomaly-w9.pdf", "/v1/docs/ide/", "//cdn.example/x", "/missing/page"])
    expect(docsLink(url, options)).toBeUndefined()
})

test("the remark plugin localizes link nodes and leaves the rest", () => {
  type Node = { type: string; url?: string; children?: Node[] }
  const tree: Node = {
    type: "root",
    children: [
      { type: "link", url: "/config", children: [] },
      { type: "link", url: "/assets/anomaly-w9.pdf", children: [] },
      { type: "link", url: "/pricing", children: [{ type: "link", url: "/build", children: [] }] },
    ],
  }
  remarkDocsLinks(options)(tree)
  expect(tree.children?.map((node) => node.url)).toEqual(["/zh/docs/config", "/docs/assets/anomaly-w9.pdf", "/pricing"])
  expect(tree.children?.[2]?.children?.[0]?.url).toBe("/zh/docs/build")
})
