const host = process.env.OPENCODE_LICENSE_MOCK_HOST || "127.0.0.1"
const port = Number(process.env.OPENCODE_LICENSE_MOCK_PORT || "8787")

const keys = {
  active: "TEST-ACTIVE-KEY",
  expired: "TEST-EXPIRED-KEY",
  invalid: "TEST-INVALID-KEY",
  grace: "TEST-GRACE-KEY",
} as const

type Mode = keyof typeof keys

const byKey = new Map(Object.entries(keys).map(([mode, key]) => [key, mode as Mode]))
const byToken = new Map(Object.keys(keys).map((mode) => [`refresh-${mode}`, mode as Mode]))

function cors(headers = new Headers()) {
  headers.set("access-control-allow-origin", "*")
  headers.set("access-control-allow-methods", "GET,POST,OPTIONS")
  headers.set("access-control-allow-headers", "content-type")
  return headers
}

function body(status: number, value: unknown) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: cors(new Headers({ "content-type": "application/json" })),
  })
}

function date(offset: number) {
  return new Date(Date.now() + offset).toISOString()
}

function license(mode: Mode) {
  if (mode === "expired") {
    return {
      status: "expired",
      masked_key: "TEST-XXXX-EXPIRED",
      plan: "starter",
      entitlement_token: `entitlement-${mode}`,
      refresh_token: `refresh-${mode}`,
      last_validated_at: date(-1000 * 60 * 60 * 24),
      expires_at: date(-1000 * 60 * 60),
      grace_until: date(-1000 * 60 * 30),
      message: "This test license is expired.",
    }
  }

  if (mode === "grace") {
    return {
      status: "active",
      masked_key: "TEST-XXXX-GRACE",
      plan: "pro",
      entitlement_token: `entitlement-${mode}`,
      refresh_token: `refresh-${mode}`,
      last_validated_at: date(-1000 * 60 * 60 * 24 * 2),
      expires_at: date(-1000 * 60 * 60),
      grace_until: date(1000 * 60 * 60 * 24 * 7),
      message: "This test license is currently inside its grace window.",
    }
  }

  return {
    status: "active",
    masked_key: mode === "active" ? "TEST-XXXX-ACTIVE" : "TEST-XXXX-KEY",
    plan: "pro",
    entitlement_token: `entitlement-${mode}`,
    refresh_token: `refresh-${mode}`,
    last_validated_at: date(0),
    expires_at: date(1000 * 60 * 60 * 24 * 30),
    grace_until: date(1000 * 60 * 60 * 24 * 37),
  }
}

async function json(req: Request) {
  const text = await req.text()
  if (!text) return {}
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return {}
  }
}

const server = Bun.serve({
  hostname: host,
  port,
  async fetch(req) {
    const url = new URL(req.url)

    if (req.method === "OPTIONS") return new Response(null, { headers: cors() })

    if (req.method === "GET" && url.pathname === "/health") {
      return body(200, { healthy: true, host, port })
    }

    if (req.method === "GET" && url.pathname === "/keys") {
      return body(200, {
        service: `http://${host}:${port}`,
        keys,
      })
    }

    if (req.method === "POST" && url.pathname === "/v1/licenses/activate") {
      const input = await json(req)
      const key = typeof input.license_key === "string" ? input.license_key.trim() : ""
      if (!key) return body(400, { error: "Missing license_key" })

      const mode = byKey.get(key)
      if (!mode || mode === "invalid") {
        return body(422, { error: "This test license key is invalid.", code: "license_invalid" })
      }

      return body(200, license(mode))
    }

    if (req.method === "POST" && url.pathname === "/v1/licenses/refresh") {
      const input = await json(req)
      const token = typeof input.refresh_token === "string" ? input.refresh_token.trim() : ""
      const mode = byToken.get(token)
      if (!mode || mode === "invalid") {
        return body(401, { error: "This test refresh token is invalid.", code: "license_invalid" })
      }

      return body(200, license(mode))
    }

    return body(404, { error: "Not found" })
  },
})

console.log(`license mock listening on http://${server.hostname}:${server.port}`)
console.log(`copy/paste keys: ${Object.values(keys).join(", ")}`)
