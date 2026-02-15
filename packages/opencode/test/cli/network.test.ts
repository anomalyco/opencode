import { test, expect } from "bun:test"
import { resolveFrom } from "../../src/cli/network"

test("explicit flags: CLI override takes precedence", () => {
  const opts = resolveFrom(
    {
      port: 8080,
      hostname: "localhost",
      mdns: false,
      "mdns-domain": "opencode.local",
      cors: [],
    },
    { server: { port: 3000, hostname: "0.0.0.0" } },
    ["node", "script.ts", "--port", "8080", "--hostname", "localhost"],
  )

  expect(opts.explicit.port).toBe(true)
  expect(opts.explicit.hostname).toBe(true)
  expect(opts.port).toBe(8080)
  expect(opts.hostname).toBe("localhost")
})

test("explicit flags: config fallback when CLI not set", () => {
  const opts = resolveFrom(
    {
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      cors: [],
    },
    { server: { port: 3000, hostname: "0.0.0.0" } },
    ["node", "script.ts"],
  )

  expect(opts.explicit.port).toBe(false)
  expect(opts.explicit.hostname).toBe(false)
  expect(opts.port).toBe(3000)
  expect(opts.hostname).toBe("0.0.0.0")
})

test("explicit flags: defaults when no CLI or config", () => {
  const opts = resolveFrom(
    {
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      cors: [],
    },
    null,
    ["node", "script.ts"],
  )

  expect(opts.explicit.port).toBe(false)
  expect(opts.explicit.hostname).toBe(false)
  expect(opts.explicit.mdns).toBe(false)
  expect(opts.explicit.mdnsDomain).toBe(false)
  expect(opts.explicit.cors).toBe(false)
  expect(opts.port).toBe(0)
  expect(opts.hostname).toBe("127.0.0.1")
  expect(opts.mdns).toBe(false)
})

test("explicit flags: mdns with hostname interaction", () => {
  const opts = resolveFrom(
    {
      port: 0,
      hostname: "127.0.0.1",
      mdns: true,
      "mdns-domain": "opencode.local",
      cors: [],
    },
    null,
    ["node", "script.ts", "--mdns"],
  )

  expect(opts.explicit.mdns).toBe(true)
  expect(opts.mdns).toBe(true)
  expect(opts.hostname).toBe("0.0.0.0")
})

test("explicit flags: cors merge from config and CLI", () => {
  const opts = resolveFrom(
    {
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "opencode.local",
      cors: ["https://test.com"],
    },
    { server: { cors: ["https://example.com"] } },
    ["node", "script.ts", "--cors", "https://test.com"],
  )

  expect(opts.explicit.cors).toBe(true)
  expect(opts.cors).toContain("https://example.com")
  expect(opts.cors).toContain("https://test.com")
})

test("explicit flags: mdns-domain explicit flag", () => {
  const opts = resolveFrom(
    {
      port: 0,
      hostname: "127.0.0.1",
      mdns: false,
      "mdns-domain": "custom.local",
      cors: [],
    },
    null,
    ["node", "script.ts", "--mdns-domain", "custom.local"],
  )

  expect(opts.explicit.mdnsDomain).toBe(true)
  expect(opts.mdnsDomain).toBe("custom.local")
})
