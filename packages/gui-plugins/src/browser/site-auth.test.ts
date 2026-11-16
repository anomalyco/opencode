import { describe, expect, test } from "bun:test"
import { challengeAnswer, challengeKey, MAX_SIGN_IN_ATTEMPTS, type Challenge } from "./site-auth"

const challenge = (input: Partial<Challenge> = {}): Challenge => ({
  url: "https://intranet.example/docs",
  isProxy: false,
  scheme: "basic",
  realm: "Docs",
  first: true,
  ...input,
})

describe("which sign-in challenges ask the user", () => {
  test("asks for the page the user opens, before it commits", () => {
    expect(challengeAnswer(challenge(), { top: "https://start.example", pending: "https://intranet.example/", attempts: 0 }))
      .toEqual({ type: "prompt", attempt: 1, key: challengeKey("https://intranet.example", "basic") })
  })

  test("asks for the page's own resources, for each scheme the user can answer", () => {
    for (const scheme of ["basic", "Digest", "ntlm", "negotiate"])
      expect(challengeAnswer(challenge({ scheme }), { top: "https://intranet.example", attempts: 0 }).type).toBe("prompt")
  })

  test("cancels a challenge from another origin embedded in the page, so it cannot phish for its sign-in", () => {
    expect(challengeAnswer(challenge({ url: "https://evil.example/pixel.png" }), { top: "https://intranet.example", attempts: 0 }))
      .toEqual({ type: "cancel" })
  })

  test("leaves a proxy's challenge to the proxy's handler, and cancels schemes and addresses it cannot answer", () => {
    expect(challengeAnswer(challenge({ isProxy: true }), { top: "https://intranet.example", attempts: 0 })).toEqual({ type: "proxy" })
    expect(challengeAnswer(challenge({ scheme: "bearer" }), { top: "https://intranet.example", attempts: 0 }).type).toBe("cancel")
    expect(
      challengeAnswer(challenge({ url: "https://user:pw@intranet.example/" }), { top: "https://intranet.example", attempts: 0 }).type,
    ).toBe("cancel")
  })

  test("asks again after a refused answer, up to the limit, then lets the refusal show", () => {
    const top = "https://intranet.example"

    const retries = Array.from({ length: MAX_SIGN_IN_ATTEMPTS }, (_, attempts) =>
      challengeAnswer(challenge({ first: false }), { top, attempts: attempts + 1 }),
    )

    expect(retries.map((answer) => (answer.type === "prompt" ? answer.attempt : answer.type))).toEqual([2, 3, "cancel"])
    // A fresh request, as a page's fetch loop makes, counts in the same visit: it does not start the count again.
    expect(challengeAnswer(challenge(), { top, attempts: MAX_SIGN_IN_ATTEMPTS })).toEqual({ type: "cancel" })
  })

  test("cannot reset the count by changing the realm on each challenge", () => {
    const top = "https://intranet.example"
    const keys = ["try-1", "try-2", "try-3"].map((realm) => challengeAnswer(challenge({ realm, first: false }), { top, attempts: 1 }))

    expect(new Set(keys.map((answer) => (answer.type === "prompt" ? answer.key : answer.type))).size).toBe(1)
  })

  test("never asks again in a visit once the user dismissed the site's sign-in", () => {
    expect(challengeAnswer(challenge(), { top: "https://intranet.example", attempts: 1, dismissed: true })).toEqual({ type: "cancel" })
  })
})
