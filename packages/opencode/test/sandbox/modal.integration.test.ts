import { describe, test, expect, beforeAll, afterAll } from "bun:test"

const MODAL_TOKEN_ID = process.env.MODAL_TOKEN_ID
const MODAL_TOKEN_SECRET = process.env.MODAL_TOKEN_SECRET
const SKIP_INTEGRATION = !MODAL_TOKEN_ID || !MODAL_TOKEN_SECRET

describe.skipIf(SKIP_INTEGRATION)("Modal Provider Integration", () => {
  let sandboxId: string | undefined

  beforeAll(() => {
    if (SKIP_INTEGRATION) {
      console.log("Skipping Modal integration tests - set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET")
    }
  })

  afterAll(async () => {
    if (sandboxId) {
      const { Sandbox } = await import("../../src/sandbox/index.js")
      const provider = Sandbox.getProvider("modal")
      if (provider) {
        try {
          await provider.terminate(sandboxId)
        } catch {}
      }
    }
  })

  test("should create a Modal sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("modal")
    expect(provider).toBeDefined()

    const instance = await provider!.create({
      provider: "modal",
      image: "python:3.11-slim",
    })

    expect(instance).toBeDefined()
    expect(instance.info.id).toBeTruthy()
    sandboxId = instance.info.id
  })

  test("should execute commands in Modal sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("modal")
    expect(provider).toBeDefined()
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    const result = await instance!.exec("echo", ["hello from modal"], { cwd: "/" })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from modal")
  })

  test("should read and write files in Modal sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("modal")
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    await instance!.writeFile("/tmp/test.txt", "Hello, Modal!")

    const content = await instance!.readFile("/tmp/test.txt")
    expect(content).toBe("Hello, Modal!")

    await instance!.deleteFile("/tmp/test.txt")

    await expect(instance!.readFile("/tmp/test.txt")).rejects.toThrow()
  })

  test("should list files in Modal sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("modal")
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    const files = await instance!.listFiles("/")
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBeGreaterThan(0)
  })

  test("should terminate Modal sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("modal")
    expect(sandboxId).toBeTruthy()

    await provider!.terminate(sandboxId!)

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeUndefined()

    sandboxId = undefined
  })
})
