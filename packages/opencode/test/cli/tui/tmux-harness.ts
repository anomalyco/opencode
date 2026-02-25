function text(buf: string | Uint8Array | undefined) {
  if (!buf) return ""
  if (typeof buf === "string") return buf
  return Buffer.from(buf).toString("utf8")
}

function run(args: string[]) {
  const out = Bun.spawnSync(["tmux", ...args])
  if (out.exitCode === 0) {
    return {
      stdout: text(out.stdout),
      stderr: text(out.stderr),
    }
  }
  throw new Error(`tmux ${args.join(" ")} failed (${out.exitCode})\n${text(out.stderr) || text(out.stdout)}`)
}

export function capturePane(name: string) {
  return run(["capture-pane", "-p", "-J", "-S", "-", "-t", name]).stdout
}

export function sendKeys(name: string, ...keys: string[]) {
  if (!keys.length) return
  run(["send-keys", "-t", name, ...keys])
}

export async function waitForText(
  name: string,
  match: string,
  opts?: {
    timeout?: number
    interval?: number
  },
) {
  const timeout = opts?.timeout ?? 10_000
  const interval = opts?.interval ?? 100
  const end = Date.now() + timeout
  let last = ""
  while (Date.now() < end) {
    last = capturePane(name)
    if (last.includes(match)) return last
    await Bun.sleep(interval)
  }
  throw new Error(`timed out waiting for "${match}"\n${last.slice(-4000)}`)
}

export function startSession(input?: {
  name?: string
  cwd?: string
  width?: number
  height?: number
  command?: string
}) {
  const name = input?.name ?? `opencode-tui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const width = input?.width ?? 220
  const height = input?.height ?? 60
  const args = ["new-session", "-d", "-s", name, "-x", String(width), "-y", String(height)]
  if (input?.cwd) args.push("-c", input.cwd)
  if (input?.command) args.push(input.command)
  run(args)
  return {
    name,
    sendKeys: (...keys: string[]) => sendKeys(name, ...keys),
    capturePane: () => capturePane(name),
    waitForText: (match: string, opts?: { timeout?: number; interval?: number }) => waitForText(name, match, opts),
    cleanup: () => {
      try {
        run(["kill-session", "-t", name])
      } catch {}
    },
  }
}
