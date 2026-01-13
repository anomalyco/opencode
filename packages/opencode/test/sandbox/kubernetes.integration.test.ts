import { describe, test, expect, beforeAll, afterAll } from "bun:test"

const KUBECONFIG = process.env.KUBECONFIG
const SKIP_INTEGRATION = !KUBECONFIG

describe.skipIf(SKIP_INTEGRATION)("Kubernetes Provider Integration", () => {
  let sandboxId: string | undefined

  beforeAll(() => {
    if (SKIP_INTEGRATION) {
      console.log("Skipping Kubernetes integration tests - set KUBECONFIG")
    }
  })

  afterAll(async () => {
    if (sandboxId) {
      const { Sandbox } = await import("../../src/sandbox/index.js")
      const provider = Sandbox.getProvider("kubernetes")
      if (provider) {
        try {
          await provider.terminate(sandboxId)
        } catch {}
      }
    }
  })

  test("should create a Kubernetes sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("kubernetes")
    expect(provider).toBeDefined()

    const instance = await provider!.create({
      provider: "kubernetes",
      image: "ubuntu:22.04",
    })

    expect(instance).toBeDefined()
    expect(instance.info.id).toBeTruthy()
    sandboxId = instance.info.id
  })

  test("should execute commands in Kubernetes sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("kubernetes")
    expect(provider).toBeDefined()
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    const result = await instance!.exec("echo", ["hello from k8s"], { cwd: "/" })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from k8s")
  })

  test("should read and write files in Kubernetes sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("kubernetes")
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    await instance!.writeFile("/tmp/test.txt", "Hello, Kubernetes!")

    const content = await instance!.readFile("/tmp/test.txt")
    expect(content).toBe("Hello, Kubernetes!")

    await instance!.deleteFile("/tmp/test.txt")

    await expect(instance!.readFile("/tmp/test.txt")).rejects.toThrow()
  })

  test("should list files in Kubernetes sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("kubernetes")
    expect(sandboxId).toBeTruthy()

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeDefined()

    const files = await instance!.listFiles("/")
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBeGreaterThan(0)
  })

  test("should terminate Kubernetes sandbox", async () => {
    const { Sandbox } = await import("../../src/sandbox/index.js")
    const provider = Sandbox.getProvider("kubernetes")
    expect(sandboxId).toBeTruthy()

    await provider!.terminate(sandboxId!)

    const instance = await provider!.get(sandboxId!)
    expect(instance).toBeUndefined()

    sandboxId = undefined
  })
})
