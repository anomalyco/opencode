import { describe, expect, test, afterEach } from "bun:test"
import { Message, LLMRequest, SystemPart, ToolDefinition } from "../src/schema/messages"
import * as OpenAIChat from "../src/protocols/openai-chat"
import { Auth } from "../src/route"
import {
  REDACTED,
  applySecretShield,
  redact,
  redactMessages,
  redactSystem,
  redactTools,
  resolveMode,
  scan,
  type ShieldResult,
} from "../src/secret-shield"
import { Model, ModelID, ProviderID } from "../src/schema"

const fakeModel = new Model({
  id: ModelID.make("fake"),
  provider: ProviderID.make("fake"),
  route: OpenAIChat.route.with({
    endpoint: { baseURL: "https://test.test/v1/" },
    auth: Auth.bearer("test"),
  }),
})

const makeRequest = (text: string, system?: string) =>
  LLMRequest.update(
    new LLMRequest({
      model: fakeModel,
      system: system ? [SystemPart.make(system)] : [],
      messages: [Message.user(text)],
      tools: [],
    }),
    {},
  )

const makeRequestWithTools = (text: string, toolDescription: string) =>
  LLMRequest.update(
    new LLMRequest({
      model: fakeModel,
      system: [],
      messages: [Message.user(text)],
      tools: [new ToolDefinition({ name: "test_tool", description: toolDescription, inputSchema: {} })],
    }),
    {},
  )

// ── Provider prefix patterns ────────────────────────────────────────────────

describe("prefix patterns", () => {
  const CASES: Record<string, string> = {
    google_api: "AIza" + "a".repeat(32),
    google_oauth: "GOCSPX-" + "a".repeat(24),
    google_access: "ya29." + "a".repeat(24),
    openai: "sk-proj-" + "a".repeat(30),
    anthropic: "sk-ant-api03-" + "a".repeat(30),
    groq: "gsk_" + "a".repeat(24),
    github: "ghp_" + "a".repeat(30),
    github_fine: "github_pat_" + "a".repeat(30),
    gitlab: "glpat-" + "a".repeat(24),
    aws: "AKIA" + "A".repeat(16),
    perm: "perm-" + "a".repeat(24),
    stripe: "sk_live_" + "a".repeat(24),
    slack: "xoxb-" + "a".repeat(24),
    sendgrid: "SG." + "a".repeat(24) + "." + "b".repeat(24),
    huggingface: "hf_" + "a".repeat(24),
    npm: "npm_" + "a".repeat(24),
    pypi: "pypi-" + "a".repeat(24),
    vault: "hvs." + "a".repeat(24),
  }

  for (const [name, key] of Object.entries(CASES)) {
    test(name, () => {
      const r = redact(`my key is ${key}`)
      expect(r.text).not.toContain(key)
      expect(r.text).toContain(REDACTED)
      expect(r.count).toBe(1)
    })
  }

  test("prefix in code context", () => {
    const r = redact('export OPENAI_API_KEY="sk-proj-abc123def456ghi789jkl012mno"')
    expect(r.text).not.toContain("abc123def456")
    expect(r.count).toBeGreaterThanOrEqual(1)
  })
})

// ── JSON sensitive fields ───────────────────────────────────────────────────

describe("json fields", () => {
  test("password field", () => {
    const r = redact('{"password":"mysecret","port":5432}')
    expect(r.text).not.toContain("mysecret")
    expect(r.text).toContain("port")
  })

  test("api_key field", () => {
    const r = redact('{"api_key":"sk-abc123"}')
    expect(r.text).not.toContain("sk-abc123")
  })

  test("nested token", () => {
    const r = redact('{"config":{"token":"secret123"}}')
    expect(r.text).not.toContain("secret123")
  })

  test("non-sensitive preserved", () => {
    const text = '{"name":"alice","port":5432}'
    const r = redact(text)
    expect(r.text).toBe(text)
    expect(r.count).toBe(0)
  })
})

// ── HTTP headers and auth schemes ───────────────────────────────────────────

describe("headers", () => {
  test("authorization header", () => {
    const r = redact("Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.payload.sig")
    expect(r.text).toContain(REDACTED)
  })

  test("cookie header", () => {
    const r = redact("Cookie: session=abc123def456; path=/")
    expect(r.text).not.toContain("abc123def456")
  })

  test("bearer inline", () => {
    const r = redact("use Bearer my_token_value_here_1234 for auth")
    expect(r.text).not.toContain("my_token_value_here_1234")
  })

  test("x-api-key header", () => {
    const r = redact("X-Api-Key: abcdefghij123456")
    expect(r.text).not.toContain("abcdefghij123456")
  })
})

// ── Connection string URIs ──────────────────────────────────────────────────

describe("connection strings", () => {
  test("postgres", () => {
    const r = redact("postgres://admin:s3cret@db.example.com:5432/mydb")
    expect(r.text).not.toContain("s3cret")
    expect(r.text).not.toContain("admin")
    expect(r.text).toContain("@db.example.com")
  })

  test("mysql", () => {
    const r = redact("mysql://root:password123@localhost:3306/db")
    expect(r.text).not.toContain("password123")
  })

  test("mongodb+srv", () => {
    const r = redact("mongodb+srv://user:pass@cluster.example.com/db")
    expect(r.text).not.toContain(":pass@")
  })

  test("redis", () => {
    const r = redact("redis://default:mysecret@redis.host:6379")
    expect(r.text).not.toContain("mysecret")
  })
})

// ── JWT-shaped tokens ───────────────────────────────────────────────────────

const makeJwt = (header: Record<string, unknown>): string => {
  const h = btoa(JSON.stringify(header)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `${h}.eyJzdWIiOiJ4In0.signature`
}

describe("jwt", () => {
  test("valid jwt", () => {
    const jwt = makeJwt({ alg: "HS256", typ: "JWT" })
    const r = redact(`token: ${jwt}`)
    expect(r.text).not.toContain(jwt)
    expect(r.text).toContain(REDACTED)
  })

  test("not a jwt", () => {
    expect(redact("some.dotted.path is fine").count).toBe(0)
  })

  test("jwt in env var", () => {
    const jwt = makeJwt({ alg: "RS256" })
    const r = redact(`export TOKEN="${jwt}"`)
    expect(r.text).not.toContain(jwt)
  })
})

// ── Clean passthrough (no false positives) ──────────────────────────────────

describe("clean passthrough", () => {
  test("plain text", () => {
    expect(redact("Hello, please review this code for bugs.").count).toBe(0)
  })

  test("code snippet", () => {
    expect(redact('fn main() {\n    let x = 42;\n    println!("hello {}", x);\n}').count).toBe(0)
  })

  test("url without creds", () => {
    expect(redact("visit https://example.com/api/v1/users").count).toBe(0)
  })

  test("port number", () => {
    expect(redact("port=5432 host=localhost").count).toBe(0)
  })

  test("empty", () => {
    expect(redact("").count).toBe(0)
  })

  test("password discussion", () => {
    expect(redact("The password is hashed with bcrypt before it hits the DB").count).toBe(0)
  })

  test("auth middleware discussion", () => {
    expect(redact("auth: middleware order is wrong, fix it").count).toBe(0)
  })
})

// ── Multiple secrets ────────────────────────────────────────────────────────

describe("multiple secrets", () => {
  test("two prefixes", () => {
    const key1 = "ghp_" + "a".repeat(30)
    const key2 = "gsk_" + "b".repeat(24)
    const r = redact(`keys: ${key1} and ${key2}`)
    expect(r.text).not.toContain(key1)
    expect(r.text).not.toContain(key2)
    expect(r.count).toBe(2)
  })

  test("prefix and uri", () => {
    const key = "AIza" + "a".repeat(32)
    const r = redact(`key=${key} db=postgres://user:pass@host/db`)
    expect(r.text).not.toContain(key)
    expect(r.text).not.toContain("user:pass")
    expect(r.count).toBeGreaterThanOrEqual(2)
  })
})

// ── Idempotency ─────────────────────────────────────────────────────────────

describe("idempotency", () => {
  const EXAMPLES = [
    "my key is ghp_" + "a".repeat(30),
    "Authorization: Bearer my_token_value_here_1234",
    "postgres://admin:s3cret@db.example.com/mydb",
    '{"password":"mysecret","port":5432}',
    "use Bearer " + "x".repeat(20) + " for auth",
  ]

  for (const text of EXAMPLES) {
    test(text.slice(0, 40), () => {
      const first = redact(text)
      const second = redact(first.text)
      expect(first.text).toBe(second.text)
      expect(second.count).toBe(0)
    })
  }
})

// ── Overlapping detectors ───────────────────────────────────────────────────

describe("overlap", () => {
  test("prefix inside assignment context", () => {
    const key = "sk-proj-" + "a".repeat(30)
    const r = redact(`api_key=${key}`)
    expect(r.text).not.toContain(key)
  })

  test("bearer with prefix token", () => {
    const r = redact("Authorization: Bearer ghp_" + "a".repeat(30))
    expect(r.text).not.toContain("ghp_")
  })

  test("uri with prefix password", () => {
    const key = "gsk_" + "a".repeat(24)
    const r = redact(`postgres://user:${key}@host/db`)
    expect(r.text).not.toContain(key)
  })
})

// ── Malformed and edge cases ────────────────────────────────────────────────

describe("edge cases", () => {
  test("very long input", () => {
    const key = "ghp_" + "a".repeat(30)
    const r = redact(`key is ${key} ` + "x".repeat(100_000))
    expect(r.text).not.toContain(key)
  })

  test("prefix surrounded by quotes", () => {
    const key = "ghp_" + "a".repeat(30)
    const r = redact(`"${key}"`)
    expect(r.text).not.toContain(key)
  })

  test("newlines around prefix", () => {
    const key = "gsk_" + "b".repeat(24)
    const r = redact(`first line\n${key}\nlast line`)
    expect(r.text).not.toContain(key)
  })

  test("only redacted marker", () => {
    expect(redact(REDACTED).count).toBe(0)
  })

  test("unicode around prefix", () => {
    const key = "perm-" + "c".repeat(24)
    const r = redact(`chiave è ${key} usala`)
    expect(r.text).not.toContain(key)
  })
})

// ── scan convenience ────────────────────────────────────────────────────────

describe("scan", () => {
  test("returns count without text", () => {
    const key = "ghp_" + "a".repeat(30)
    expect(scan(`key is ${key}`)).toBe(1)
  })

  test("zero for clean text", () => {
    expect(scan("fix the bug")).toBe(0)
  })
})

// ── redactMessages ──────────────────────────────────────────────────────────

describe("redactMessages", () => {
  test("masks text content", () => {
    const key = "ghp_" + "a".repeat(30)
    const messages = [
      Message.make({ role: "system", content: "You are helpful." }),
      Message.user(`my key is ${key}`),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBe(1)
    expect(JSON.stringify(r.messages)).toContain(REDACTED)
    expect(JSON.stringify(r.messages)).not.toContain(key)
    expect(JSON.stringify(messages)).toContain(key)
  })

  test("skips non-text parts", () => {
    const messages = [
      Message.make({
        role: "user",
        content: [
          { type: "text", text: "clean text" },
          { type: "media", mediaType: "image/png", data: "base64data" },
        ],
      }),
    ]
    const r = redactMessages(messages)
    expect(r.count).toBe(0)
    expect(r.messages).toBe(messages)
  })

  test("clean passthrough returns same ref", () => {
    const messages = [Message.user("fix the bug")]
    const r = redactMessages(messages)
    expect(r.count).toBe(0)
    expect(r.messages).toBe(messages)
  })

  test("empty list", () => {
    expect(redactMessages([]).count).toBe(0)
  })
})

// ── redactSystem ────────────────────────────────────────────────────────────

describe("redactSystem", () => {
  test("masks system text", () => {
    const key = "sk-proj-" + "z".repeat(30)
    const system = [SystemPart.make(`key is ${key}`)]
    const r = redactSystem(system)
    expect(r.count).toBe(1)
    expect(r.system[0]!.text).toContain(REDACTED)
    expect(r.system[0]!.text).not.toContain(key)
  })

  test("clean passthrough returns same ref", () => {
    const system = [SystemPart.make("You are terse.")]
    const r = redactSystem(system)
    expect(r.count).toBe(0)
    expect(r.system).toBe(system)
  })
})

// ── redactTools ─────────────────────────────────────────────────────────────

describe("redactTools", () => {
  test("masks secret in tool description", () => {
    const key = "ghp_" + "a".repeat(30)
    const tools = [new ToolDefinition({ name: "my_tool", description: `Use key ${key}`, inputSchema: {} })]
    const r = redactTools(tools)
    expect(r.count).toBe(1)
    expect(r.tools[0]!.description).toContain(REDACTED)
    expect(r.tools[0]!.description).not.toContain(key)
    expect(r.tools[0]!.name).toBe("my_tool")
  })

  test("clean passthrough returns same ref", () => {
    const tools = [new ToolDefinition({ name: "tool", description: "Search the web", inputSchema: {} })]
    const r = redactTools(tools)
    expect(r.count).toBe(0)
    expect(r.tools).toBe(tools)
  })

  test("empty list", () => {
    expect(redactTools([]).count).toBe(0)
  })
})

// ── resolveMode ─────────────────────────────────────────────────────────────

describe("resolveMode", () => {
  const saved = process.env.OPENCODE_SECRET_SHIELD

  afterEach(() => {
    if (saved === undefined) delete process.env.OPENCODE_SECRET_SHIELD
    else process.env.OPENCODE_SECRET_SHIELD = saved
  })

  test("default is off", () => {
    delete process.env.OPENCODE_SECRET_SHIELD
    expect(resolveMode()).toBe("off")
  })

  test("env 0 is off", () => {
    process.env.OPENCODE_SECRET_SHIELD = "0"
    expect(resolveMode()).toBe("off")
  })

  test("env 1 is mask", () => {
    process.env.OPENCODE_SECRET_SHIELD = "1"
    expect(resolveMode()).toBe("mask")
  })

  test("env true is mask", () => {
    process.env.OPENCODE_SECRET_SHIELD = "true"
    expect(resolveMode()).toBe("mask")
  })

  test("env warn is warn", () => {
    process.env.OPENCODE_SECRET_SHIELD = "warn"
    expect(resolveMode()).toBe("warn")
  })

  test("env block is block", () => {
    process.env.OPENCODE_SECRET_SHIELD = "block"
    expect(resolveMode()).toBe("block")
  })

  test("override takes precedence", () => {
    process.env.OPENCODE_SECRET_SHIELD = "block"
    expect(resolveMode("warn")).toBe("warn")
  })
})

// ── applySecretShield request-level ─────────────────────────────────────────

describe("applySecretShield", () => {
  const ok = (result: ShieldResult) => {
    expect(result._tag).toBe("ok")
    return result as Extract<ShieldResult, { _tag: "ok" }>
  }

  test("off returns same ref", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "off"))
    expect(result.request).toBe(req)
    expect(result.report.detected).toBe(0)
  })

  test("warn returns same ref with detection count", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "warn"))
    expect(result.request).toBe(req)
    expect(result.report.detected).toBe(1)
    expect(result.report.mode).toBe("warn")
    expect(JSON.stringify(result.request.messages)).toContain(key)
  })

  test("mask replaces secrets", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequest(`key is ${key}`)
    const result = ok(applySecretShield(req, "mask"))
    expect(result.request).not.toBe(req)
    expect(result.report.detected).toBe(1)
    expect(JSON.stringify(result.request.messages)).not.toContain(key)
    expect(JSON.stringify(result.request.messages)).toContain(REDACTED)
  })

  test("mask returns same ref when clean", () => {
    const req = makeRequest("fix the bug")
    const result = ok(applySecretShield(req, "mask"))
    expect(result.request).toBe(req)
    expect(result.report.detected).toBe(0)
  })

  test("block returns blocked on finding", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequest(`key is ${key}`)
    const result = applySecretShield(req, "block")
    expect(result._tag).toBe("blocked")
    expect(result.report.detected).toBe(1)
    expect(result.report.mode).toBe("block")
  })

  test("block passes clean input", () => {
    const req = makeRequest("fix the bug")
    const result = ok(applySecretShield(req, "block"))
    expect(result.request).toBe(req)
  })

  test("block report has no secrets", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequest(`key is ${key}`)
    const result = applySecretShield(req, "block")
    expect(result._tag).toBe("blocked")
    expect(JSON.stringify(result.report)).not.toContain(key)
  })

  test("mask redacts system parts too", () => {
    const key = "sk-proj-" + "x".repeat(30)
    const req = makeRequest("hello", `system key ${key}`)
    const result = ok(applySecretShield(req, "mask"))
    expect(JSON.stringify(result.request.system)).not.toContain(key)
    expect(JSON.stringify(result.request.system)).toContain(REDACTED)
  })

  test("mask redacts tool descriptions", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequestWithTools("hello", `Use API key ${key} to call`)
    const result = ok(applySecretShield(req, "mask"))
    expect(result.request.tools[0]!.description).not.toContain(key)
    expect(result.request.tools[0]!.description).toContain(REDACTED)
    expect(result.request.tools[0]!.name).toBe("test_tool")
  })

  test("block detects secrets in tool descriptions", () => {
    const key = "ghp_" + "a".repeat(30)
    const req = makeRequestWithTools("hello", `Use key ${key}`)
    const result = applySecretShield(req, "block")
    expect(result._tag).toBe("blocked")
    expect(result.report.detected).toBeGreaterThanOrEqual(1)
  })

  test("fail-closed on internal error", () => {
    const req = makeRequest("hello")
    const original = Object.getOwnPropertyDescriptor(req, "messages")!
    Object.defineProperty(req, "messages", {
      get() {
        throw new Error("boom")
      },
    })
    try {
      const result = applySecretShield(req, "mask")
      expect(result._tag).toBe("blocked")
      expect(result.report.error).toBeDefined()
    } finally {
      Object.defineProperty(req, "messages", original)
    }
  })
})
