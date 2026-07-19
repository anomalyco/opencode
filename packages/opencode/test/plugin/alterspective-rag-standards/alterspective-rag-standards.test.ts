import { describe, expect, test, beforeAll, afterEach } from "bun:test"
import plugin from "../../../../../.opencode/plugin/alterspective-rag-standards"

const mockInput = {} as any

const originalEnabled = process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED
const originalDisabled = process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED

describe("alterspective-rag-standards", () => {
  let hooks: any

  beforeAll(async () => {
    delete process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED
    delete process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED
    hooks = await plugin(mockInput)
  })

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED
    else process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED = originalEnabled
    if (originalDisabled === undefined) delete process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED
    else process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED = originalDisabled
  })

  test("returns hooks with experimental.chat.system.transform", () => {
    expect(typeof hooks["experimental.chat.system.transform"]).toBe("function")
  })

  test("hook appends a string to output.system", async () => {
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]({ model: {} as any }, output)
    expect(output.system.length).toBe(1)
    expect(typeof output.system[0]).toBe("string")
  })

  test("added string contains Alterspective Standards Awareness heading", async () => {
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]({ model: {} as any }, output)
    expect(output.system[0]).toContain("Alterspective Standards Awareness")
  })

  test("added string mentions rag_search or rag_ask", async () => {
    const output = { system: [] as string[] }
    await hooks["experimental.chat.system.transform"]({ model: {} as any }, output)
    expect(output.system[0].includes("rag_search") || output.system[0].includes("rag_ask")).toBe(true)
  })

  test("does NOT inject when ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED=true", async () => {
    process.env.ALTERSPECTIVE_STANDARDS_INJECTION_DISABLED = "true"
    const localHooks: any = await plugin(mockInput)
    const output = { system: [] as string[] }
    await localHooks["experimental.chat.system.transform"]({ model: {} as any }, output)
    expect(output.system.length).toBe(0)
  })

  test("does NOT inject when ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED=false", async () => {
    process.env.ALTERSPECTIVE_STANDARDS_INJECTION_ENABLED = "false"
    const localHooks: any = await plugin(mockInput)
    const output = { system: [] as string[] }
    await localHooks["experimental.chat.system.transform"]({ model: {} as any }, output)
    expect(output.system.length).toBe(0)
  })
})
