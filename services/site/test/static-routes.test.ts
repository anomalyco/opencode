import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
// SolidStart's own file router, which builds the route manifest the static renderer finds pages in.
import { DEFAULT_EXTENSIONS } from "../node_modules/@solidjs/start/dist/config/constants.js"
import { SolidStartServerFileRouter } from "../node_modules/@solidjs/start/dist/config/fs-router.js"
import { staticPath, staticPaths } from "~/static/routes"

const router = new SolidStartServerFileRouter({
  dir: fileURLToPath(new URL("../src/routes", import.meta.url)),
  extensions: DEFAULT_EXTENSIONS,
})
const manifest: { path: string; page?: boolean }[] = await router.getRoutes()
// An index route's path ends in a slash (/brand/).
const pages = manifest.filter((route) => route.page).map((route) => route.path.replace(/(.)\/$/, "$1"))

describe("static routes", () => {
  test("each is a page route, so src/static/render.tsx can find its component", () => {
    expect(staticPaths.filter((path) => !pages.includes(path))).toEqual([])
  })

  test("match their pages' addresses and nothing else", () => {
    expect(staticPath("/brand")).toBe("/brand")
    expect(staticPath("/legal")).toBe("/legal")
    expect(staticPath("/legal/privacy-policy")).toBe("/legal/privacy-policy")
    expect(staticPath("/changelog/v1.2.3")).toBe("/changelog/:tag")
    expect(staticPath("/changelog")).toBe("/changelog")
    expect(staticPath("/")).toBeUndefined()
    expect(staticPath("/desktop")).toBeUndefined()
    expect(staticPath("/legal/nope/deeper")).toBeUndefined()
    expect(staticPath("/brand/extra")).toBeUndefined()
  })
})
