import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, verify } from "node:crypto"
import { githubAppJwt } from "~/lib/github-app"

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString())

describe("githubAppJwt", () => {
  // GitHub's downloaded keys are PKCS#1; PKCS#8 works too, and so does a key stored with literal \n.
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const keys = {
    pkcs1: pair.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    pkcs8: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }

  for (const [name, pem] of Object.entries({ ...keys, escaped: keys.pkcs1.replace(/\n/g, "\\n") })) {
    test(`signs an RS256 app JWT with a ${name} key`, async () => {
      const jwt = await githubAppJwt("12345", pem, Date.UTC(2026, 10, 5, 12))
      const [header, payload, signature] = jwt.split(".")
      expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" })
      const now = Date.UTC(2026, 10, 5, 12) / 1000
      expect(decode(payload)).toEqual({ iat: now - 60, exp: now + 540, iss: "12345" })
      const valid = verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        pair.publicKey,
        Buffer.from(signature, "base64url"),
      )
      expect(valid).toBe(true)
    })
  }
})
