import { afterEach, describe, expect, test } from "bun:test"
import { H3, HTTPError } from "nitro/h3"
import { noindexDev } from "../src/lib/noindex"

// The middleware in an h3 app like the site's, answering the kinds of response its routes return.
const app = new H3()
app.use(noindexDev)
app.get("/page", () => "<!doctype html>")
app.get("/markdown", () => new Response("# Page", { headers: { "Content-Type": "text/markdown" } }))
app.get("/moved", () => new Response(null, { status: 301, headers: { Location: "/page" } }))
app.get("/missing", () => new Response("Not found", { status: 404 }))
app.get("/broken", () => {
  throw new HTTPError({ status: 500 })
})
const paths = ["/page", "/markdown", "/moved", "/missing", "/broken", "/unrouted"]

const stage = process.env.STAGE
afterEach(() => {
  if (stage === undefined) delete process.env.STAGE
  else process.env.STAGE = stage
})

async function robots(stage: string) {
  process.env.STAGE = stage
  const responses = await Promise.all(paths.map((path) => app.fetch(new Request(`https://opencode.ai${path}`))))
  return responses.map((response) => response.headers.get("X-Robots-Tag"))
}

describe("noindex on dev", () => {
  test("every dev response asks search engines not to index it", async () => {
    expect(await robots("dev")).toEqual(paths.map(() => "noindex, nofollow"))
  })

  test("production responses don't", async () => {
    expect(await robots("production")).toEqual(paths.map(() => null))
  })
})
