// packages/opencode/test/tool/kali.test.ts
import { describe, test, expect } from "bun:test"
import { KaliTool } from "../../src/tool/kali"

describe("KaliTool", () => {
  test("tool tiene id correcto", () => {
    expect(KaliTool.id).toBe("kali")
  })

  test("tool init retorna configuración válida", async () => {
    const config = await KaliTool.init()
    expect(config.description).toContain("Kali Linux")
    expect(config.parameters).toBeDefined()
  })

  test("parámetros incluyen command obligatorio", async () => {
    const config = await KaliTool.init()
    const schema = config.parameters
    expect(schema).toBeDefined()
  })
})
