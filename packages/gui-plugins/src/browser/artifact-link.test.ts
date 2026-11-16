import { expect, test } from "bun:test"
import { artifactAddress, artifactLink, artifactResource, artifactWebURL } from "./artifact-link"
import { resolvePreviewRequest, type PreviewSource } from "./workspace-file"

const base = "https://example.test:444/mounted"

const view = "/api/experimental/artifacts/art_aBc123/view"

const display = "artifact://art_aBc123/"

test("only this server's artifact view is a pane link, including behind a base path", () => {
  for (const root of [view, `${base}${view}`]) {
    expect(artifactLink(root, base)).toBe(display)
    expect(artifactLink(`${root}/`, base)).toBe(display)
    expect(artifactLink(`${root}/assets/50%25.svg`, base)).toBe(`${display}assets/50%25.svg`)
  }

  expect(artifactLink(`https://EXAMPLE.test:443${view}`, "https://example.test")).toBe(display)

  for (const other of [
    "https://provider.test/report",
    `https://example.test${view}`,
    `${base}.other${view}`,
    `${view}er/`,
    view.replace("/view", "/update"),
    view.replace("art_aBc123", "art_"),
    `${view}?location=other`,
    `${view}/../x`,
    `${view}/%2e%2e/x`,
    `${view}/a%2fb`,
    `${view}/a%5cb`,
    `${view}//host`,
    `${view}/a\\b`,
  ])
    expect(artifactLink(other, base)).toBeUndefined()
})

test("an artifact address round trips without the server URL; web uses its ordinary view URL", () => {
  const path = "assets/50%25.svg"
  expect(artifactAddress(display + path)).toEqual({ id: "art_aBc123", path })
  expect(artifactWebURL(display + path, base)).toBe(`${base}${view}/${path}`)
  expect(artifactWebURL(display, "https://name:pass@example.test")).toBeUndefined()
  expect(artifactResource(`oc-preview://grant/${path}?ignored=yes#fragment`, "grant", "art_aBc123")).toEqual({
    display: display + path,
    route: `${view}/${path}`,
  })
})

test("no foreign origin, path or method can choose where the grant sends credentials", async () => {
  const grants = new Map<string, PreviewSource>([
    ["first", { type: "artifact", id: "art_aBc123", read: () => Promise.reject(new Error("not a byte read")) }],
  ])

  const request = (path: string, method = "GET", origin: string | undefined = "oc-preview://first") =>
    resolvePreviewRequest(`oc-preview://first/${path}`, method, origin, grants, AbortSignal.timeout(1000))

  expect(await request("")).toMatchObject({ route: `${view}/` })
  expect(await request("assets/app.js?location[directory]=other", "HEAD")).toMatchObject({
    route: `${view}/assets/app.js`,
  })
  expect(await request("api/session")).toMatchObject({ route: `${view}/api/session` })

  for (const path of ["../x", "%2e%2e/x", "c:/x", "/other", "x%2fy", "x%5cy", "x\\y"])
    expect(await request(path)).toBeUndefined()

  for (const origin of ["https://web.test", "null", "oc-preview://second"])
    expect(await request("", "GET", origin)).toBeUndefined()
  expect(await request("index.html", "POST")).toBeUndefined()
  grants.clear()
  expect(await request("")).toBeUndefined()
})
