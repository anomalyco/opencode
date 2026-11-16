import { expect, test } from "bun:test"
import { menuAddress, pageMenu } from "./page-menu"

const policy = { fileRoots: ["/work"], previewHost: "binding", extensions: ["installed"], local: true }

const preview = "oc-preview://binding/work/page.html"

test.each([
  ["https://example.test/a", "https://example.test/", "https://example.test/a"],
  ["https://user:pass@example.test", preview, undefined],
  ["file:///work/image.png", preview, undefined],
  ["oc-preview://binding/work/image.png", preview, "file:///work/image.png"],
  ["oc-preview://binding/work/image.png", "https://example.test", undefined],
  ["oc-preview://foreign/work/image.png", preview, undefined],
  ["oc-preview://binding/outside/image.png", preview, undefined],
  ["javascript:alert(0)", preview, undefined],
  ["chrome-extension://installed/page", preview, "chrome-extension://installed/page"],
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
