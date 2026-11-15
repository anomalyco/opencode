import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { startServer } from "./fixture/server"

it.live("rejects API navigations and calls from other sites while other clients pass", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "page.html"), "<p>hi</p>"))
    const server = yield* startServer(path.join(tmp.path, "config"))
    const read = new URL("/api/fs/read/page.html", server.base)
    read.searchParams.set("location[directory]", tmp.path)
    const status = (url: URL | string, headers: Record<string, string>, method = "GET") =>
      Effect.promise(async () => {
        const response = await fetch(new URL(url, server.base), {
          method,
          headers: { ...server.headers, ...headers },
        })
        return response.status
      })
    const navigate = (site: string) => ({
      "sec-fetch-site": site,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    })

    // Native clients, same-origin pages and typed-in URLs.
    expect(yield* status(read, {})).toBe(200)
    expect(yield* status(read, navigate("same-origin"))).toBe(200)
    expect(yield* status(read, navigate("none"))).toBe(200)
    expect(yield* status(read, { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" })).toBe(200)

    // Another site opening an API URL as a page.
    expect(yield* status(read, navigate("cross-site"))).toBe(403)
    expect(yield* status(read, navigate("same-site"))).toBe(403)
    expect(yield* status("/api/path", navigate("cross-site"))).toBe(403)
    expect(yield* status("/api/path", navigate("cross-site"), "POST")).toBe(403)

    // Calls from other sites need an allowed origin; media elements send none.
    const cors = (origin: string) => ({ "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", origin })
    expect(yield* status(read, cors("https://app.opencode.ai"))).toBe(200)
    expect(yield* status(read, cors("oc://renderer"))).toBe(200)
    expect(yield* status(read, cors("http://localhost:3000"))).toBe(200)
    expect(yield* status(read, cors("https://example.com"))).toBe(403)
    expect(yield* status("/api/path", cors("null"), "POST")).toBe(403)
    expect(
      yield* status(
        "/api/path",
        { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", origin: "https://example.com" },
        "POST",
      ),
    ).toBe(403)
    expect(
      yield* status(read, { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "video" }),
    ).toBe(200)

    // Pairing links and artifact pages are opened from elsewhere on purpose.
    expect(yield* status("/auth/connect/expired", { ...navigate("cross-site"), accept: "text/html" })).toBe(401)
    const artifact = new URL("/api/experimental/artifacts/art_missing/view/", server.base)
    artifact.searchParams.set("location[directory]", tmp.path)
    const opened = yield* Effect.promise(() =>
      fetch(artifact, { headers: { ...server.headers, ...navigate("cross-site") } }).then((response) =>
        response.json(),
      ),
    )
    expect(opened.message).not.toBe("Cross-site requests to the API are not allowed")
  }),
)
