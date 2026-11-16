import { expect, test } from "bun:test"
import { menuAddress, pageMenu } from "./page-menu"
import { extensionResource } from "./profile/extension-api/resource"

const policy = { fileRoots: ["/work"], previewHost: "binding", extensions: ["installed"], local: true }

const preview = "oc-preview://binding/work/page.html"

test.each([
  ["https://site.test", "public/a.js?q=1", true], ["https://site.test", "private.html", false],
  ["https://other.test", "public/a.js", false], ["null", "public/a.js", false],
  ["https://site.test", "session/a.js", false], ["https://site.test", "public/%5c..%5cprivate.html", false],
  ["chrome-extension://installed", "private.html", true], ["chrome-extension://other", "public/a.js", false],
  ["https://site.test", "public/../private.html", false], ["https://site.test", "public/a.js:stream", false],
] as const)("%s may open %s: %s", (origin, path, allowed) => {
  const manifest = { manifest_version: 3, web_accessible_resources: [
    { resources: ["public/*"], matches: ["https://site.test/*"] },
    { resources: ["session/*"], matches: ["<all_urls>"], use_dynamic_url: true },
  ] }

  expect(extensionResource(`chrome-extension://installed/${path}`, origin, () => ({ manifest }))).toBe(allowed)
})

test.each([
  ["https://example.test/a", "https://example.test/", "https://example.test/a"],
  ["https://user:pass@example.test", preview, undefined],
  ["file:///work/image.png", preview, undefined],
  ["oc-preview://binding/work/image.png", preview, "file:///work/image.png"],
  ["oc-preview://binding/work/image.png", "https://example.test", undefined],
  ["oc-preview://foreign/work/image.png", preview, undefined],
  ["oc-preview://binding/outside/image.png", preview, undefined],
  ["javascript:alert(0)", preview, undefined],
  ["chrome-extension://installed/page", preview, undefined],
  ["chrome-extension://unknown/page", preview, undefined],
] as const)("context target %s in %s", (raw, frame, address) => {
  expect(menuAddress(raw, frame, policy)).toBe(address)
})

const basic = {
  pageURL: "https://example.test",
  frameURL: "",
  srcURL: "",
  linkURL: "",
  mediaType: "none",
  selectionText: "",
  hasImageContents: false,
  isEditable: false,
  dictionarySuggestions: [],
  misspelledWord: "",
  editFlags: {
    canCopy: true,
    canCut: false,
    canPaste: false,
    canSelectAll: true,
    canEditRichly: false,
    canUndo: false,
    canRedo: false,
    canDelete: false,
  },
} as const

const options = {
  policy,
  back: false,
  forward: true,
  spellcheck: true,
  dictionaries: ["en-US"],
  languages: ["en-US"],
  t: (key: string) => key.slice(5),
  run() {},
  extensions: [{ label: "Extension" }],
}

test.each([
  { name: "plain", params: {}, items: [] },
  { name: "selection", params: { selectionText: "word" }, items: ["copy"] },
  { name: "link", params: { linkURL: "https://example.test/link" }, items: ["openLink", "external", "copyLink"] },
  {
    name: "preview image",
    params: { pageURL: preview, mediaType: "image", hasImageContents: true, srcURL: "oc-preview://binding/work/img" },
    items: ["openImage", "saveImage", "copyImage", "copyImageAddress"],
  },
  {
    name: "editable",
    params: { isEditable: true, misspelledWord: "speling", dictionarySuggestions: ["spelling"] },
    items: ["spelling", "addWord", "!cut", "copy", "!paste", "!pastePlain", "selectAll", "spellcheck", "languages"],
  },
] satisfies { name: string; params: Partial<Parameters<typeof pageMenu>[0]>; items: string[] }[])(
  "$name gets one menu with contextual enabled states and extension items",
  ({ params, items }) => {
    const template = pageMenu(
      {
        ...basic,
        ...params,
        dictionarySuggestions: "dictionarySuggestions" in params ? (params.dictionarySuggestions ?? []) : [],
      },
      options,
    )

    expect(
      template.filter((x) => x.type !== "separator").map((x) => `${x.enabled === false ? "!" : ""}${x.label}`),
    ).toEqual(["!back", "forward", "reload", ...items, "Extension"])
  },
)

// A remote server's preview: its files show as `workspace:` display addresses; nothing names the server or its URL.
const remote = { previewHost: "binding", remote: "workspace://ses_1/", local: false }

const remotePage = "oc-preview://binding/site/page.html"

test.each([
  ["oc-preview://binding/site/img.png", remotePage, "workspace://ses_1/site/img.png"],
  ["oc-preview://binding/site/a%20b.html", remotePage, "workspace://ses_1/site/a%20b.html"],
  ["oc-preview://binding/../secret", remotePage, undefined],
  ["oc-preview://binding/site%2f..%2fsecret", remotePage, undefined],
  ["oc-preview://foreign/site/img.png", remotePage, undefined],
  ["oc-preview://binding/site/img.png", "https://example.test/", undefined],
] as const)("remote context target %s in %s", (raw, frame, address) => {
  expect(menuAddress(raw, frame, remote)).toBe(address)
})

test("a loopback link opens in the system browser only when the server runs on this machine", () => {
  const labels = (local: boolean) =>
    pageMenu(
      { ...basic, dictionarySuggestions: [], linkURL: "http://localhost:3000/" },
      { ...options, policy: { ...policy, local } },
    )
      .filter((item) => item.type !== "separator")
      .map((item) => item.label)

  expect(labels(true)).toContain("external")
  expect(labels(false)).not.toContain("external")
  expect(labels(false)).toContain("copyLink")
})
