import { expect, test } from "bun:test"
import { OwnedFetch } from "../src/internal/fetch"

test("completed responses release request listeners without aborting the caller", async () => {
  const caller = new AbortController()
  const aborted: string[] = []
  const owned = OwnedFetch.make(
    async (request) => {
      const path = new URL(request.url).pathname
      request.signal.addEventListener("abort", () => aborted.push(path), { once: true })
      return path === "/empty" ? new Response(null, { status: 204 }) : new Response("result")
    },
    async () => {},
  )

  const response = await owned.fetch("http://localhost/body", { signal: caller.signal })
  expect(aborted).toEqual([])
  expect(await response.text()).toBe("result")
  expect(aborted).toEqual(["/body"])

  const empty = await owned.fetch("http://localhost/empty", { signal: caller.signal })
  expect(empty.status).toBe(204)
  expect(aborted).toEqual(["/body", "/empty"])
  expect(caller.signal.aborted).toBe(false)
  await owned.close()
})

test("an active response remains readable until it is cancelled", async () => {
  const caller = new AbortController()
  let aborted = 0
  const owned = OwnedFetch.make(
    async (request) => {
      request.signal.addEventListener("abort", () => aborted++, { once: true })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first"))
          },
        }),
      )
    },
    async () => {},
  )

  const response = await owned.fetch("http://localhost/stream", { signal: caller.signal })
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("first")
  expect(aborted).toBe(0)
  await reader.cancel()
  expect(aborted).toBe(1)
  expect(caller.signal.aborted).toBe(false)
  await owned.close()
})
