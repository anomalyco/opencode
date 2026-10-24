import { createInterface } from "node:readline"
import { Schema } from "effect"
import { access } from "node:fs/promises"
import { spawn } from "node:child_process"

export type ClipboardProcess = ReturnType<typeof createClipboardProcess>

export function createClipboardProcess(command: ReadonlyArray<string>) {
  const children = new Set<ReturnType<typeof startClipboardProcess>>()
  let lease: { owner: ReturnType<typeof startClipboardProcess>; key: string } | undefined
  let pending = Promise.resolve()

  async function write(text: string, env: NodeJS.ProcessEnv, client?: number) {
    const key = JSON.stringify([
      env.DISPLAY,
      env.XAUTHORITY,
      env.WAYLAND_DISPLAY,
      env.XDG_RUNTIME_DIR,
      env.HOME,
      client,
    ])
    const owner =
      lease?.key === key &&
      !lease.owner.child.killed &&
      !lease.owner.child.stdin.writableEnded &&
      children.has(lease.owner)
        ? lease.owner
        : startClipboardProcess(command, env, client)
    if (!children.has(owner)) {
      children.add(owner)
      void owner.exited.then(
        () => children.delete(owner),
        () => children.delete(owner),
      )
    }
    const timeout = setTimeout(() => owner.child.kill(), 10_000)
    const reader = owner.child.stdout.iterator({ destroyOnReturn: false })
    let ready = false
    try {
      owner.child.stdin.write(JSON.stringify(text) + "\n")
      const response = await reader.next()
      if (response.done || response.value[0] !== 1) {
        await owner.exited
        throw new Error(owner.stderr.join("").trim() || "Clipboard helper did not accept the copy")
      }
      if (lease?.owner !== owner) lease?.owner.child.stdin.end()
      lease = { owner, key }
      ready = true
    } finally {
      clearTimeout(timeout)
      await reader.return?.()
      if (!ready) owner.child.kill()
    }
  }

  return {
    write(text: string, env: NodeJS.ProcessEnv, client?: number) {
      // A reused helper has one acknowledgement per request. Serialize copies so
      // readers cannot consume another request's acknowledgement.
      const result = pending.then(() => write(text, env, client))
      pending = result.catch(() => {})
      return result
    },
    async dispose() {
      await pending
      children.forEach((owner) => owner.child.stdin.end())
      await Promise.all(Array.from(children, (owner) => owner.exited))
    },
  }
}

function startClipboardProcess(command: ReadonlyArray<string>, env: NodeJS.ProcessEnv, client?: number) {
  const child = spawn(command[0], command.slice(1), {
    env: { ...env, OPENCODE_CLIPBOARD_HELPER: "1", OPENCODE_SSH_ASKPASS_PORT: undefined },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  const stderr: string[] = []
  child.stderr.setEncoding("utf8").on("data", (text: string) => stderr.push(text))
  child.stdin.on("error", () => child.kill())
  // An open forwarded X11 channel otherwise keeps ssh alive after tmux detaches.
  if (client !== undefined) {
    const detached = setInterval(() => {
      void access(`/proc/${client}`).catch(() => {
        clearInterval(detached)
        child.stdin.end()
      })
    }, 250)
    detached.unref()
    void exited.then(
      () => clearInterval(detached),
      () => clearInterval(detached),
    )
  }
  return { child, exited, stderr }
}

// Run in a separate process: native clipboard libraries read the process
// environment, and a tmux client may belong to a different desktop after attach.
export async function runClipboardProcess() {
  const { createHostClipboard } = await import("@opentui/core")
  const clipboard = createHostClipboard()
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  try {
    for await (const line of input) {
      const text = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.String))(line)
      const result = await clipboard.writeText(text, { selection: "clipboard" })
      if (result.status === "failed") throw result.error
      if (result.status !== "written") throw new Error(`Desktop clipboard write ${result.status}`)
      process.stdout.write(Buffer.from([1]))
      // Keep stdin open so the X11 selection owner can serve paste requests.
    }
  } finally {
    input.close()
    await clipboard.dispose()
  }
}
