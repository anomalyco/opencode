import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Credential } from "../src/credential.js"
import { CredentialLegacy } from "../src/credential-legacy.js"

const decode = Schema.decodeUnknownSync(CredentialLegacy.Value)
const legacy = {
  type: "key",
  key: "secret",
  metadata: { imported: true, resourceName: "older" },
  configuration: { resourceName: "answered", accountId: "account" },
}

describe("CredentialLegacy", () => {
  test("decodes key form answers written to configuration before v2.1 into metadata, keeping answers first", () => {
    expect(decode(legacy)).toEqual({
      type: "key",
      key: "secret",
      metadata: { imported: true, resourceName: "answered", accountId: "account" },
    })
    expect(decode({ type: "key", key: "secret", configuration: { resourceName: "answered" } })).toEqual({
      type: "key",
      key: "secret",
      metadata: { resourceName: "answered" },
    })
  })

  test("decodes current values and exported entries unchanged", () => {
    const current = { type: "key", key: "secret", metadata: { resourceName: "answered" } } as const
    expect(decode(current)).toEqual(current)
    const external = { type: "external", methodID: "azure-cli", metadata: { resourceName: "answered" } } as const
    expect(Schema.encodeSync(Credential.Value)(decode(external))).toEqual(external)
    expect(
      Schema.decodeUnknownSync(CredentialLegacy.Entry)({
        id: "cred_legacy",
        integrationID: "azure",
        label: "Work",
        active: true,
        value: legacy,
      }).value,
    ).toEqual(decode(legacy))
  })

  test("rejects invalid legacy configuration", () => {
    expect(() => decode({ type: "key", key: "secret", configuration: "answered" })).toThrow()
  })

  test("the public credential schema does not know configuration", () => {
    expect(Schema.decodeUnknownSync(Credential.Value)(legacy)).toEqual({
      type: "key",
      key: "secret",
      metadata: { imported: true, resourceName: "older" },
    })
  })
})
