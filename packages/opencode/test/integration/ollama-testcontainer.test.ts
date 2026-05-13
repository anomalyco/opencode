import { afterAll, describe, expect, test } from "bun:test"
import { GenericContainer, Network, type StartedNetwork, type StartedTestContainer } from "testcontainers"

// ~1.3GB pull; Docker VM disk + ollama unpack often dominates over headline ISP Mbps.
const t = 1_200_000

async function waitHttp(url: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`timeout waiting for ${url}`)
}

describe.skipIf(process.env.OPENCODE_OLLAMA_TC_TEST !== "1")("Ollama (Testcontainers)", () => {
  let ollama: StartedTestContainer | undefined
  let net: StartedNetwork | undefined

  afterAll(async () => {
    if (ollama) await ollama.stop()
    if (net) await net.stop()
  })

  test(
    "starts Ollama, pulls llama3.2:1b, lists model",
    async () => {
      net = await new Network().start()
      ollama = await new GenericContainer("ollama/ollama:latest")
        .withNetwork(net)
        .withNetworkAliases("ollama")
        .withExposedPorts(11434)
        .withStartupTimeout(180_000)
        .start()

      const host = ollama.getHost()
      const port = ollama.getMappedPort(11434)
      const base = `http://${host}:${port}`
      await waitHttp(`${base}/api/tags`, 120_000)

      const pull = await ollama.exec(["ollama", "pull", "llama3.2:1b"])
      if (pull.exitCode !== 0) {
        throw new Error(`ollama pull failed (exit ${pull.exitCode}): ${pull.stderr || pull.output}`)
      }

      const tags = await fetch(`${base}/api/tags`)
      if (!tags.ok) throw new Error(`tags: HTTP ${tags.status}`)
      const body = (await tags.json()) as { models?: Array<{ name: string }> }
      if (!body.models) throw new Error("missing models")
      const names = body.models.map((m) => m.name)
      expect(names.some((n) => n.includes("llama3.2:1b"))).toBe(true)
    },
    { timeout: t },
  )
})
