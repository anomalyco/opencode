import { describe, expect, test } from "bun:test"
import { CLASSICAL_GROUPS, tlsFallbackFetch } from "../src/tls-fallback.js"
import { tlsFilter } from "./fixtures/tls-filter.js"

// The checks wait on real handshakes through the relay, so the windows are real time: long enough for a loopback
// handshake on a loaded runner, short enough that a dropped one is given up on quickly.
const timing = { stall: 100, probe: 1_000 }

const origin = (seen: string[]) =>
  tlsFilter(async (request) => {
    if (request.method === "HEAD") return new Response(null)
    const body = await request.text()
    seen.push(`${request.method} ${new URL(request.url).pathname} ${body}`)
    return new Response(`echo ${body}`)
  })

const post = (ca: string, body: string, extra?: RequestInit) =>
  ({ method: "POST", body, tls: { ca }, ...extra }) as RequestInit

describe("tlsFallbackFetch", () => {
  test("the runtime's standard handshake does not pass a filter that drops a large ClientHello", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)

    const error = await fetch(
      `${filter.origin}/chat`,
      post(filter.ca, "hi", { signal: AbortSignal.timeout(500) }),
    ).catch((cause: Error) => cause)

    expect(error).toMatchObject({ name: "TimeoutError" })
    expect(seen).toEqual([])
    expect(filter.hellos).toHaveLength(1)
    expect(filter.hellos[0]!.shares).toContain("X25519MLKEM768")
    expect(filter.hellos[0]!.bytes).toBeGreaterThan(1400)
    expect(filter.hellos[0]!.passed).toBe(false)
  })

  test("sends the request once, on the classical handshake, when the standard one is dropped", async () => {
    const seen: string[] = []
    const fallbacks: string[] = []
    await using filter = await origin(seen)
    const send = tlsFallbackFetch({ ...timing, onFallback: (host) => fallbacks.push(host) })

    const response = await send(`${filter.origin}/chat`, post(filter.ca, "hi"))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("echo hi")
    expect(seen).toEqual(["POST /chat hi"])
    expect(fallbacks).toEqual([filter.origin])
    const passed = filter.hellos.filter((hello) => hello.passed)
    expect(passed.length).toBeGreaterThan(0)
    // One TCP segment carries at least 1220 bytes on any IPv6 path and 1360 on the affected lines in #60661.
    expect(Math.max(...passed.map((hello) => hello.bytes))).toBeLessThan(600)
    expect(passed.flatMap((hello) => hello.shares)).not.toContain("X25519MLKEM768")
  })

  test("sends the request once when the standard handshake is reset", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    filter.mode = "reset"
    const send = tlsFallbackFetch(timing)

    const response = await send(`${filter.origin}/chat`, post(filter.ca, "hi"))

    expect(await response.text()).toBe("echo hi")
    expect(seen).toEqual(["POST /chat hi"])
  })

  test("keeps a host on the classical handshake without trying the standard one again", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    const send = tlsFallbackFetch(timing)
    await send(`${filter.origin}/first`, post(filter.ca, "a")).then((response) => response.text())
    const before = filter.hellos.length

    const response = await send(`${filter.origin}/second`, post(filter.ca, "b", { keepalive: false }))

    expect(await response.text()).toBe("echo b")
    expect(seen).toEqual(["POST /first a", "POST /second b"])
    expect(filter.hellos.slice(before).every((hello) => hello.passed)).toBe(true)
  })

  test("leaves a host that completes the standard handshake alone, even when it answers slowly", async () => {
    const requests: string[] = []
    const fallbacks: string[] = []
    const answer = Promise.withResolvers<void>()
    await using filter = await tlsFilter(async (request) => {
      if (request.method === "HEAD") return new Response(null)
      requests.push(await request.text())
      await answer.promise
      return new Response("late")
    })
    filter.mode = "pass"
    const send = tlsFallbackFetch({ ...timing, onFallback: (host) => fallbacks.push(host) })

    const pending = send(`${filter.origin}/chat`, post(filter.ca, "hi"))
    // The check runs once the request has waited `stall`: both of its handshakes reach the relay.
    await until(() => filter.hellos.length >= 3)
    answer.resolve()
    const response = await pending

    expect(await response.text()).toBe("late")
    expect(requests).toEqual(["hi"])
    expect(fallbacks).toEqual([])
    expect(filter.hellos[0]!.shares).toContain("X25519MLKEM768")
  })

  test("still verifies the server certificate on the classical handshake", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    const send = tlsFallbackFetch(timing)
    await send(`${filter.origin}/first`, post(filter.ca, "a")).then((response) => response.text())

    // Without the fixture's certificate authority the server's self-signed certificate is untrusted.
    const error = await send(`${filter.origin}/second`, { method: "POST", body: "b" }).catch((cause: Error) => cause)

    expect(error).toMatchObject({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })
    expect(seen).toEqual(["POST /first a"])
  })

  test("does not resend a streamed body, and moves the next request to the classical handshake", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    const send = tlsFallbackFetch(timing)
    const stream = new Blob(["streamed"]).stream()

    const error = await send(
      `${filter.origin}/upload`,
      post(filter.ca, "", { body: stream, signal: AbortSignal.timeout(timing.stall + timing.probe + 500) }),
    ).catch((cause: Error) => cause)
    const response = await send(`${filter.origin}/chat`, post(filter.ca, "hi"))

    expect(error).toMatchObject({ name: "TimeoutError" })
    expect(await response.text()).toBe("echo hi")
    expect(seen).toEqual(["POST /chat hi"])
  })

  test("returns a host to the standard handshake once the network passes it", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    const send = tlsFallbackFetch({ ...timing, retry: 0 })
    await send(`${filter.origin}/first`, post(filter.ca, "a")).then((response) => response.text())
    filter.mode = "pass"

    // This request still takes the classical handshake and starts the check that clears the host.
    await send(`${filter.origin}/second`, post(filter.ca, "b")).then((response) => response.text())
    await until(async () => {
      const before = filter.hellos.length
      await send(`${filter.origin}/again`, post(filter.ca, "c", { keepalive: false })).then((response) =>
        response.text(),
      )
      return filter.hellos.slice(before).some((hello) => hello.shares.includes("X25519MLKEM768"))
    })
  })

  test("leaves a caller's own key exchange groups alone", async () => {
    const seen: string[] = []
    await using filter = await origin(seen)
    filter.mode = "pass"
    const send = tlsFallbackFetch(timing)

    const response = await send(`${filter.origin}/chat`, {
      method: "POST",
      body: "hi",
      tls: { ca: filter.ca, ecdhCurve: "P-256" },
    } as RequestInit)

    expect(await response.text()).toBe("echo hi")
    expect(filter.hellos.map((hello) => hello.shares)).toEqual([["P-256"]])
    expect(CLASSICAL_GROUPS).toBe("X25519:P-256:P-384")
  })
})

async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition not reached within 10s")
    await Bun.sleep(10)
  }
}
