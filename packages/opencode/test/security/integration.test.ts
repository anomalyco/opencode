// packages/opencode/test/security/integration.test.ts
import { describe, test, expect, beforeAll } from "bun:test"
import { KaliContainer } from "../../src/security/kali/container"
import { KaliTool } from "../../src/tool/kali"

describe.skipIf(!process.env.KALI_TESTS)("Security Integration Tests", () => {
  let kali: KaliContainer

  beforeAll(async () => {
    kali = new KaliContainer()
    const dockerCheck = await kali.checkDocker()
    if (!dockerCheck.available) {
      throw new Error("Docker not available for integration tests")
    }
  })

  test("crea y ejecuta comando en contenedor Kali", async () => {
    const containerId = await kali.createOneShot()
    expect(containerId).toBeTruthy()
    expect(containerId).toMatch(/^kali-\d+-[a-z0-9]{6}$/)

    const result = await kali.exec(containerId, "echo 'hello from kali'")
    expect(result.stdout).toContain("hello from kali")

    await kali.destroy(containerId)
  })

  test("KaliTool init correctamente", async () => {
    const config = await KaliTool.init()
    expect(config.description).toContain("Kali")
  })

  test("parsea comandos correctamente", () => {
    const parsed = KaliContainer.parseCommand("nmap -sV -p22,80,443 192.168.1.1")
    expect(parsed.command).toBe("nmap")
    expect(parsed.args).toEqual(["-sV", "-p22,80,443", "192.168.1.1"])
  })

  afterAll(async () => {
    await kali?.cleanup()
  })
})
