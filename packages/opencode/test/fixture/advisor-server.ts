import path from "node:path"
import { mkdir, realpath } from "node:fs/promises"

export async function serve(input: { directory: string; port: number; scenario?: string }) {
  if (!path.isAbsolute(input.directory)) throw new Error("Advisor fixture directory must be absolute")
  await mkdir(input.directory, { recursive: true })
  const directory = await realpath(input.directory)
  const state = path.join(path.dirname(directory), "advisor-state")
  await mkdir(state, { recursive: true })
  for (const key of [
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_SERVER_PASSWORD",
    "OPENCODE_PID",
    "OPENCODE_MODELS_PATH",
  ])
    delete process.env[key]
  process.env.XDG_CONFIG_HOME = path.join(state, "config")
  process.env.XDG_DATA_HOME = path.join(state, "data")
  process.env.XDG_CACHE_HOME = path.join(state, "cache")
  process.env.OPENCODE_DB = path.join(state, "opencode.db")
  process.env.OPENCODE_DISABLE_DEFAULT_PLUGINS = "true"
  process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
  process.env.OPENCODE_DISABLE_SHARE = "true"
  process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ anthropic: { type: "api", key: "offline-advisor-fixture" } })
  process.env.OPENCODE_ADVISOR_FIXTURE_SCENARIO = input.scenario ?? "complete"
  process.env.OPENCODE_ADVISOR_FIXTURE_LOG = path.join(state, "requests.jsonl")

  const model = (id: string, input: number, output: number) => ({
    id,
    name: id,
    attachment: false,
    reasoning: false,
    temperature: false,
    tool_call: true,
    release_date: "2026-01-01",
    limit: { context: 200000, output: 4096 },
    cost: { input, output },
  })
  const config = Bun.file(path.join(directory, "opencode.json"))
  if (!(await config.exists()))
    await Bun.write(
      config,
      JSON.stringify(
        {
          model: "anthropic/claude-sonnet-4-6",
          small_model: "anthropic/claude-sonnet-4-6",
          enabled_providers: ["anthropic"],
          autoupdate: false,
          share: "disabled",
          plugin: [new URL("./advisor-plugin.ts", import.meta.url).href],
          agent: {
            build: { advisor: { model: "claude-opus-4-6", maxUses: 1 }, steps: 8, permission: { advisor: "allow" } },
          },
          provider: {
            anthropic: {
              name: "Advisor fixture",
              npm: "@ai-sdk/anthropic",
              env: ["ANTHROPIC_API_KEY"],
              api: "https://api.anthropic.com/v1",
              models: {
                "claude-sonnet-4-6": model("claude-sonnet-4-6", 3, 15),
                "claude-opus-4-6": model("claude-opus-4-6", 5, 25),
              },
            },
          },
        },
        null,
        2,
      ),
    )
  const fixture = Bun.file(path.join(directory, "pool.ts"))
  if (!(await fixture.exists())) await Bun.write(fixture, "export const limit = 2\n")
  const { Server } = await import("../../src/server/server")
  const listener = await Server.listen({ hostname: "127.0.0.1", port: input.port })
  return { listener, directory, state }
}

if (import.meta.main) {
  const value = (name: string) => {
    const index = process.argv.indexOf(name)
    return index < 0 ? undefined : process.argv[index + 1]
  }
  const directory = value("--directory")
  if (!directory) throw new Error("--directory is required")
  const server = await serve({ directory, port: Number(value("--port") ?? 0), scenario: value("--scenario") })
  console.log(JSON.stringify({ url: server.listener.url.href, directory: server.directory, state: server.state }))
  const stop = () => void server.listener.stop(true).then(() => process.exit(0))
  process.once("SIGTERM", stop)
  process.once("SIGINT", stop)
}
