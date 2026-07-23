import { describe, expect, test } from "bun:test"
import { extractIdentity } from "../../src/auth/jwt"

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function makeJwt(payload: object, header: object = { alg: "RS256", typ: "JWT" }): string {
  const h = Buffer.from(JSON.stringify(header), "utf8").toString("base64url")
  const p = encodePayload(payload)
  return `${h}.${p}.sig`
}

describe("Azure AD claims extraction", () => {
  test("extracts roles from JWT with Azure App Roles claim", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "alice@contoso.com",
      name: "Alice Smith",
      tid: "tenant-1",
      roles: ["opencode-admins", "opencode-devs"],
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.roles).toEqual(["opencode-admins", "opencode-devs"])
    expect(identity?.email).toBe("alice@contoso.com")
    expect(identity?.displayName).toBe("Alice Smith")
  })

  test("extracts single role from Azure App Roles claim", () => {
    const token = makeJwt({
      oid: "guid-abc",
      roles: ["opencode-devs"],
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.roles).toEqual(["opencode-devs"])
  })

  test("extracts extension attributes from extn.* claims", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "bob@contoso.com",
      "extn.monthlyTokenAllowance": "100000",
      "extn.allowedModels": "opencode/*,anthropic/*",
      "extn.department": "engineering",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.extensionAttrs).toEqual({
      monthlyTokenAllowance: "100000",
      allowedModels: "opencode/*,anthropic/*",
      department: "engineering",
    })
  })

  test("extracts groups claim from JWT", () => {
    const token = makeJwt({
      oid: "guid-abc",
      groups: ["group-id-1", "group-id-2"],
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.groups).toEqual(["group-id-1", "group-id-2"])
  })

  test("handles JWT without any Azure AD claims gracefully", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "carol@contoso.com",
      name: "Carol Davis",
      tid: "tenant-1",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.roles).toBeUndefined()
    expect(identity?.groups).toBeUndefined()
    expect(identity?.extensionAttrs).toBeUndefined()
    // Standard fields still work
    expect(identity?.email).toBe("carol@contoso.com")
    expect(identity?.displayName).toBe("Carol Davis")
    expect(identity?.tenantId).toBe("tenant-1")
  })

  test("extracts both roles and extension attrs from same JWT", () => {
    const token = makeJwt({
      oid: "guid-abc",
      preferred_username: "dave@contoso.com",
      roles: ["opencode-devs"],
      "extn.monthlyTokenAllowance": "75000",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.roles).toEqual(["opencode-devs"])
    expect(identity?.extensionAttrs).toEqual({ monthlyTokenAllowance: "75000" })
    expect(identity?.email).toBe("dave@contoso.com")
  })

  test("ignores non-string extension attributes", () => {
    const token = makeJwt({
      oid: "guid-abc",
      "extn.count": 42,
      "extn.active": true,
      "extn.label": "valid-string",
    })

    const identity = extractIdentity(token)
    expect(identity).not.toBeNull()
    expect(identity?.extensionAttrs).toEqual({ label: "valid-string" })
  })

  test("still returns null for missing oid even with Azure claims", () => {
    const token = makeJwt({
      preferred_username: "eve@contoso.com",
      roles: ["opencode-admins"],
      "extn.monthlyTokenAllowance": "50000",
    })

    expect(extractIdentity(token)).toBeNull()
  })
})
