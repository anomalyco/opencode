import { expect, test } from "bun:test"
import { Connection } from "@opencode/schema/connection"
import { Schema } from "effect"

test("connection method ID is optional and omitted for API keys", () => {
  const decode = Schema.decodeUnknownSync(Connection.CredentialInfo)
  const encode = Schema.encodeSync(Connection.CredentialInfo)
  const key = decode({ type: "credential", id: "cred_key", label: "API key", method: "key" })
  expect(encode(key)).toEqual({ type: "credential", id: "cred_key", label: "API key", method: "key" })
  const oauth = decode({
    type: "credential",
    id: "cred_chatgpt",
    label: "ChatGPT",
    method: "oauth",
    methodID: "chatgpt-token-sharing",
  })
  expect(encode(oauth)).toMatchObject({ method: "oauth", methodID: "chatgpt-token-sharing" })
})
