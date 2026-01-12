import { z } from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Shell } from "@/shell/shell"

const log = Log.create({ service: "sudo-tool" })

// Use system's seahorse askpass for GUI password prompt
const ASKPASS_PATH = "/usr/lib/seahorse/ssh-askpass"

export const SudoTool = Tool.define("sudo", {
  description: `Run commands with elevated privileges using sudo.

This tool runs commands with sudo using a GUI password prompt (seahorse).
After you approve the command, a password dialog will appear on your screen.

Prerequisites:
  - seahorse package must be installed (provides /usr/lib/seahorse/ssh-askpass)

Usage examples:
  sudo pacman -S neovim
  sudo systemctl restart docker
  sudo apt update && sudo apt upgrade

Note: A GUI password dialog will appear - enter your password there.`,
  parameters: z.object({
    command: z.string().describe("The command to run with sudo (e.g., pacman -S neovim)"),
    timeout: z
      .number()
      .describe("Optional timeout in milliseconds (default: 5 minutes)")
      .optional(),
  }),
  async execute({ command, timeout = 5 * 60 * 1000 }, ctx) {
    // Ask for permission first
    await ctx.ask({
      permission: "sudo",
      patterns: [command],
      always: [],
      metadata: { command },
    })

    const shell = Shell.acceptable()
    const cwd = Instance.directory

    log.info("spawning sudo command with seahorse askpass", { command, shell, cwd })

    // Use sudo -A which uses SUDO_ASKPASS for password input
    const proc = spawn(shell, ["-c", `sudo -A ${command}`], {
      cwd,
      env: {
        ...process.env,
        SUDO_ASKPASS: ASKPASS_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let output = ""
    let timedOut = false
    let aborted = false

    // Initialize metadata
    ctx.metadata({
      metadata: {
        output: "",
        command: `sudo ${command}`,
      },
    })

    const append = (chunk: Buffer) => {
      output += chunk.toString()
      ctx.metadata({
        metadata: {
          output: output.length > 30000 ? output.slice(-30000) : output,
          command: `sudo ${command}`,
        },
      })
    }

    proc.stdout?.on("data", append)
    proc.stderr?.on("data", append)

    // Set up abort handling
    const abortHandler = () => {
      aborted = true
      try {
        proc.kill("SIGTERM")
      } catch {}
    }
    ctx.abort.addEventListener("abort", abortHandler, { once: true })

    // Set up timeout
    const timeoutTimer = setTimeout(() => {
      timedOut = true
      try {
        proc.kill("SIGTERM")
      } catch {}
    }, timeout)

    // Wait for process to exit
    const exitCode = await new Promise<number>((resolve) => {
      proc.once("exit", (code) => {
        resolve(code ?? 1)
      })
      proc.once("error", (err) => {
        log.error("sudo process error", { error: err.message })
        resolve(1)
      })
    })

    // Cleanup
    clearTimeout(timeoutTimer)
    ctx.abort.removeEventListener("abort", abortHandler)

    log.info("sudo command completed", { command, exitCode, timedOut, aborted })

    const cleanOutput = output.trim()

    let resultOutput = cleanOutput
    if (timedOut) {
      resultOutput = `Command timed out after ${timeout}ms\n\n${cleanOutput}`
    } else if (aborted) {
      resultOutput = `Command was aborted\n\n${cleanOutput}`
    } else if (exitCode === 0) {
      resultOutput = cleanOutput || "Command completed successfully"
    } else {
      resultOutput = cleanOutput || `Command failed with exit code ${exitCode}`
    }

    return {
      title: `sudo ${command}`,
      output: resultOutput,
      metadata: { exitCode, timedOut, aborted },
    }
  },
})
