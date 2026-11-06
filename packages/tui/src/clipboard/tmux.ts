import type { OwnedClipboardService } from "../clipboard"
import { readFile } from "node:fs/promises"
import type { ClipboardProcess } from "./process"
import { spawn } from "node:child_process"
import { once } from "node:events"

export function createTmuxClipboard(
  clipboard: OwnedClipboardService,
  env = process.env,
  host?: ClipboardProcess,
): OwnedClipboardService {
  const pane = env.TMUX_PANE
  if (!env.TMUX || !pane) {
    if (!host || !forwardedX11(env)) return clipboard
    return {
      ...clipboard,
      async write(text) {
        await host.write(text.replaceAll("\0", ""), { ...env, WAYLAND_DISPLAY: undefined })
        return "written"
      },
    }
  }
  return {
    ...clipboard,
    async write(text) {
      // A persistent pane can be reattached from another computer. Its original
      // desktop clipboard and SSH environment do not identify the current client.
      const [client, pid, features] = (
        await runTmux(
          ["display-message", "-p", "-t", pane, "#{client_tty}\n#{client_pid}\n#{client_termfeatures}"],
          env,
        )
      )
        .trim()
        .split("\n")
      if (!client) throw new Error("No tmux client is attached to copy to")
      // tmux refreshes its session environment on attach, but that environment
      // is shared by clients. Read the selected client's own environment instead.
      const attached =
        process.platform === "linux"
          ? await readFile(`/proc/${pid}/environ`, "utf8").then(
              (value) =>
                Object.fromEntries(
                  value
                    .split("\0")
                    .filter(Boolean)
                    .map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
                ),
              () => undefined,
            )
          : undefined
      const target = tmuxClipboardTarget(env, attached)
      if (target === "original") return clipboard.write(text)
      if (host && attached && target === "host") {
        await host.write(
          text.replaceAll("\0", ""),
          {
            ...attached,
            // A forwarded X11 connection must not use the server's Wayland desktop.
            WAYLAND_DISPLAY: ssh(attached) ? undefined : attached.WAYLAND_DISPLAY,
          },
          ssh(attached) ? Number(pid) : undefined,
        )
        return "written"
      }
      if (!features?.split(",").includes("clipboard")) {
        throw new Error("The attached tmux terminal does not advertise clipboard support")
      }
      // This asks tmux to emit OSC 52 itself, so allow-passthrough is not needed.
      await runTmux(["load-buffer", "-w", "-t", client, "-"], env, text.replaceAll("\0", ""))
      // tmux's clipboard feature and exit status do not confirm terminal acceptance.
      return "attempted"
    },
  }
}

// Without client environment (including non-Linux hosts), preserve the local
// backend or route a known SSH startup through tmux. Never use an old desktop
// for a client we know is remote.
export function tmuxClipboardTarget(env: NodeJS.ProcessEnv, attached?: NodeJS.ProcessEnv) {
  if (!attached) return ssh(env) ? "terminal" : "original"
  if (forwardedX11(attached)) return "host"
  if (ssh(attached)) return "terminal"
  if (
    !ssh(env) &&
    ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "HOME"].every((key) => env[key] === attached[key])
  ) {
    return "original"
  }
  if (attached.DISPLAY || attached.WAYLAND_DISPLAY) return "host"
  return "original"
}

function ssh(env: NodeJS.ProcessEnv) {
  return Boolean(env.SSH_TTY || env.SSH_CONNECTION)
}

function forwardedX11(env: NodeJS.ProcessEnv) {
  return ssh(env) && /^(localhost|127\.0\.0\.1|\[::1\]):\d+(\.\d+)?$/.test(env.DISPLAY ?? "")
}

async function runTmux(args: string[], env: NodeJS.ProcessEnv, text?: string) {
  const proc = spawn("tmux", args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const stdout: string[] = []
  const stderr: string[] = []
  proc.stdout.setEncoding("utf8").on("data", (text: string) => stdout.push(text))
  proc.stderr.setEncoding("utf8").on("data", (text: string) => stderr.push(text))
  proc.stdin.on("error", () => proc.kill())
  proc.stdin.end(text)
  // Bound the request even if killing the client does not close its streams.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const [code] = await Promise.race([
      once(proc, "close"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          proc.kill("SIGKILL")
          proc.stdin.destroy()
          proc.stdout.destroy()
          proc.stderr.destroy()
          reject(new Error("tmux clipboard command timed out"))
        }, 5000)
      }),
    ])
    if (code !== 0) throw new Error(stderr.join("").trim() || "tmux clipboard command failed")
    return stdout.join("")
  } finally {
    clearTimeout(timer)
  }
}
