// packages/opencode/test/security/kali/container.test.ts
import { describe, test, expect, beforeEach } from "bun:test"
import { KaliContainer } from "@/security/kali/container"

describe("KaliContainer", () => {
  let kali: KaliContainer

  beforeEach(() => {
    kali = new KaliContainer()
  })

  test("genera unique container ID", () => {
    const id1 = KaliContainer.generateId()
    const id2 = KaliContainer.generateId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^kali-\d+-[a-z0-9]{6}$/)
  })

  test("parsea comando simple", () => {
    const parsed = KaliContainer.parseCommand("nmap -sV 192.168.1.1")
    expect(parsed.command).toBe("nmap")
    expect(parsed.args).toEqual(["-sV", "192.168.1.1"])
  })
})
