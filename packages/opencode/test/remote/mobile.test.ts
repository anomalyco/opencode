import { describe, expect, test } from "bun:test"
import { Script } from "node:vm"
import { RemoteMobile } from "@/remote/mobile"

function clientScript() {
  const match = RemoteMobile.markup().match(/<script>([\s\S]*?)<\/script>/)
  if (!match?.[1]) throw new Error("remote mobile script not found")
  return match[1]
}

describe("remote mobile", () => {
  test("emits parseable browser JavaScript", () => {
    const script = clientScript()

    expect(() => new Script(script)).not.toThrow()
    expect(script).toContain('.join("\\n")')
    expect(script).toContain('/\\r\\n\\r\\n|\\n\\n|\\r\\r/')
  })

  test("contains explicit access-expiry handling", () => {
    const script = clientScript()

    expect(script).toContain("function expireRemoteAccess()")
    expect(script).toContain("state.token = \"\"")
    expect(script).toContain("state.sessionID = \"\"")
    expect(script).toContain("response.status === 401 || response.status === 403")
  })
})
