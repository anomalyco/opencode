import { afterEach, describe, expect, test } from "bun:test"
import { ensureLoopbackNoProxy } from "./proxy-env"

const saved = { upper: process.env.NO_PROXY, lower: process.env.no_proxy }

afterEach(() => {
  delete process.env.NO_PROXY
  delete process.env.no_proxy

  if (saved.upper !== undefined) process.env.NO_PROXY = saved.upper

  if (saved.lower !== undefined) process.env.no_proxy = saved.lower
})

describe("ensureLoopbackNoProxy", () => {
  const cases: ReadonlyArray<{
    readonly name: string
    readonly upper?: string
    readonly lower?: string
    readonly expected: string
  }> = [
    {
      name: "populates loopback exemptions when unset",
      expected: "127.0.0.1,localhost,::1",
    },
    {
      name: "copies uppercase NO_PROXY into lowercase no_proxy",
      upper: "corp.internal, .example.internal",
      expected: "corp.internal,.example.internal,127.0.0.1,localhost,::1",
    },
    {
      name: "deduplicates existing loopback entries case-insensitively",
      upper: "LOCALHOST,127.0.0.1,::1",
      expected: "LOCALHOST,127.0.0.1,::1",
    },
    {
      name: "appends explicit 127.0.0.1 alongside Windows wildcard entries",
      upper: "172.31.*,127.*,localhost",
      expected: "172.31.*,127.*,localhost,127.0.0.1,::1",
    },
    {
      name: "preserves universal wildcard intact",
      upper: "corp.internal, *",
      expected: "*",
    },
    // Win32 environment blocks fold NO_PROXY and no_proxy into one variable before JS runs.
    ...(process.platform === "win32"
      ? []
      : [
          {
            name: "merges distinct uppercase and lowercase entries",
            upper: "a.internal",
            lower: "b.internal",
            expected: "a.internal,b.internal,127.0.0.1,localhost,::1",
          },
        ]),
  ]

  test.each(cases)("$name", ({ upper, lower, expected }) => {
    delete process.env.NO_PROXY
    delete process.env.no_proxy

    if (upper !== undefined) process.env.NO_PROXY = upper

    if (lower !== undefined) process.env.no_proxy = lower

    ensureLoopbackNoProxy()

    expect(process.env.NO_PROXY).toBe(expected)
    expect(process.env.no_proxy).toBe(expected)
  })
})
