import { expect, test } from "bun:test"
import { allowed, namespaceOf, type ApiNamespace } from "./api"
import { apiManifest } from "./manifest"

const namespaces: ApiNamespace[] = [
  { path: "tabs", methods: ["query"] },
  { path: "storage.sync", permissions: ["storage"], methods: ["get"] },
  { path: "cookies", permissions: ["cookies"], methods: ["get"] },
  { path: "action", manifest: 3, methods: ["setPopup"] },
  { path: "browserAction", manifest: 2, methods: ["setPopup"] },
]

const v3 = apiManifest({ manifest: { manifest_version: 3, permissions: ["storage"] } })

// The trust check before every chrome.* call and subscription: which extension may reach which namespace.
test.each([
  { name: "tabs.query", manifest: v3, expected: true, why: "a namespace without permissions is every extension's" },
  { name: "storage.sync.get", manifest: v3, expected: true, why: "the extension declares storage" },
  { name: "cookies.get", manifest: v3, expected: false, why: "the extension does not declare cookies" },
  { name: "action.setPopup", manifest: v3, expected: true, why: "Manifest V3 has action" },
  { name: "browserAction.setPopup", manifest: v3, expected: false, why: "browserAction is Manifest V2's" },
  {
    name: "action.setPopup",
    manifest: apiManifest({ manifest: { manifest_version: 2 } }),
    expected: false,
    why: "action is Manifest V3's",
  },
  { name: "storage.get", manifest: v3, expected: false, why: "storage.get is no namespace's member here" },
  { name: "storage.sync.get.extra", manifest: v3, expected: false, why: "a name with an extra dot is no member" },
  { name: "tabs", manifest: v3, expected: false, why: "a bare namespace is no member" },
  { name: "unknown.method", manifest: v3, expected: false, why: "an unknown namespace is refused" },
  {
    name: "cookies.get",
    manifest: apiManifest({ manifest: { permissions: [{ not: "a string" }, "cookies"] } }),
    expected: true,
    why: "unusual entries do not hide the others",
  },
  { name: "storage.sync.get", manifest: apiManifest({ manifest: "not a manifest" }), expected: false, why: "no manifest, no permission" },
])("$name: $expected, as $why", (row) => {
  expect(allowed(row.manifest, namespaceOf(namespaces, row.name))).toBe(row.expected)
})

test("a name belongs to the namespace whose path is all before its member", () => {
  expect(namespaceOf(namespaces, "storage.sync.get")?.path).toBe("storage.sync")
  expect(namespaceOf(namespaces, "tabs.query")?.path).toBe("tabs")
  expect(namespaceOf(namespaces, "tabsx.query")).toBeUndefined()
})
