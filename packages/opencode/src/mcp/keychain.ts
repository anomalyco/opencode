import { Effect } from "effect"
import { spawn } from "child_process"

// OS keychain access for MCP OAuth secrets via the platform CLI tools, mirroring Gemini CLI's
// hybrid approach: macOS `security`, Linux secret-service `secret-tool`. When no tool is
// available (or OPENCODE_MCP_FORCE_FILE_STORAGE=1) callers fall back to the file store.
const SERVICE = "opencode-mcp"

const forcedFileStorage = () => process.env["OPENCODE_MCP_FORCE_FILE_STORAGE"] === "1"

const run = (cmd: string, args: string[], input?: string) =>
  Effect.promise(
    () =>
      new Promise<{ code: number; stdout: string }>((resolve) => {
        // stdout must stay piped even for write operations so lookups can read secrets back
        const child = spawn(cmd, args, {
          stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        })
        let stdout = ""
        if (input !== undefined && child.stdin) {
          child.stdin.write(input)
          child.stdin.end()
        }
        child.stdout?.on("data", (chunk) => (stdout += chunk.toString()))
        child.on("error", () => resolve({ code: 1, stdout: "" }))
        child.on("close", (code) => resolve({ code: code ?? 1, stdout }))
      }),
  )

let availableCache: boolean | undefined

const available = Effect.fn("Keychain.available")(function* () {
  if (forcedFileStorage()) return false
  if (availableCache !== undefined) return availableCache
  const probe =
    process.platform === "darwin"
      ? yield* run("security", ["list-keychains"])
      : process.platform === "linux"
        ? yield* run("sh", ["-c", "command -v secret-tool"])
        : { code: 1, stdout: "" }
  availableCache = probe.code === 0
  return availableCache
})

const get = Effect.fn("Keychain.get")(function* (name: string) {
  const result =
    process.platform === "darwin"
      ? yield* run("security", ["find-generic-password", "-s", SERVICE, "-a", name, "-w"])
      : yield* run("secret-tool", ["lookup", "service", SERVICE, "account", name])
  const text = result.stdout.trim()
  if (result.code !== 0 || !text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
})

const set = Effect.fn("Keychain.set")(function* (name: string, value: unknown) {
  const payload = JSON.stringify(value)
  const result =
    process.platform === "darwin"
      ? yield* run("security", ["add-generic-password", "-s", SERVICE, "-a", name, "-w", payload, "-U"])
      : yield* run("secret-tool", ["store", "--label=opencode-mcp", "service", SERVICE, "account", name], payload)
  return result.code === 0
})

const remove = Effect.fn("Keychain.remove")(function* (name: string) {
  const result =
    process.platform === "darwin"
      ? yield* run("security", ["delete-generic-password", "-s", SERVICE, "-a", name])
      : yield* run("secret-tool", ["clear", "service", SERVICE, "account", name])
  return result.code === 0
})

export const Keychain = { available, get, set, remove }
