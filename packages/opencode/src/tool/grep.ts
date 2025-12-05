import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import { Ripgrep } from "../file/ripgrep"

import DESCRIPTION from "./grep.txt"
import { Instance } from "../project/instance"

const MAX_LINE_LENGTH = 2000
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000
const SIGKILL_TIMEOUT_MS = 200

export const GrepTool = Tool.define("grep", {
  description: DESCRIPTION,
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
  }),
  async execute(params, ctx) {
    if (!params.pattern) {
      throw new Error("pattern is required")
    }
    if (params.timeout !== undefined && params.timeout < 0) {
      throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
    }
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

    const searchPath = params.path || Instance.directory

    const rgPath = await Ripgrep.filepath()
    const args = ["-nH", "--field-match-separator=|", "--regexp", params.pattern]
    if (params.include) {
      args.push("--glob", params.include)
    }
    args.push(searchPath)

    const proc = spawn(rgPath, args, {
      cwd: Instance.directory,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let output = ""
    let errorOutput = ""
    let timedOut = false
    let aborted = false
    let exited = false

    const killTree = async () => {
      const pid = proc.pid
      if (!pid || exited) {
        return
      }

      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
          killer.once("exit", resolve)
          killer.once("error", () => resolve())
        })
        return
      }

      try {
        process.kill(-pid, "SIGTERM")
        await Bun.sleep(SIGKILL_TIMEOUT_MS)
        if (!exited) {
          process.kill(-pid, "SIGKILL")
        }
      } catch {
        proc.kill("SIGTERM")
        await Bun.sleep(SIGKILL_TIMEOUT_MS)
        if (!exited) {
          proc.kill("SIGKILL")
        }
      }
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString()
    })
    proc.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString()
    })

    if (ctx.abort.aborted) {
      aborted = true
      await killTree()
    }

    const abortHandler = () => {
      aborted = true
      void killTree()
    }

    ctx.abort.addEventListener("abort", abortHandler, { once: true })

    const timeoutTimer = setTimeout(() => {
      timedOut = true
      void killTree()
    }, timeout)

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeoutTimer)
        ctx.abort.removeEventListener("abort", abortHandler)
      }

      proc.once("exit", (code) => {
        exited = true
        cleanup()
        resolve(code)
      })

      proc.once("error", (error) => {
        exited = true
        cleanup()
        reject(error)
      })
    })

    if (aborted) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false, timedOut: false },
        output: "<grep_metadata>\nCommand aborted by user\n</grep_metadata>\n\nNo files found",
      }
    }

    if (timedOut) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false, timedOut: true },
        output: `<grep_metadata>\nCommand terminated after exceeding timeout ${timeout} ms\n</grep_metadata>\n\nNo files found`,
      }
    }

    if (exitCode === 1) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false, timedOut: false },
        output: "No files found",
      }
    }

    if (exitCode !== 0) {
      throw new Error(`ripgrep failed: ${errorOutput}`)
    }

    const lines = output.trim().split("\n")
    const matches = []

    for (const line of lines) {
      if (!line) continue

      const [filePath, lineNumStr, ...lineTextParts] = line.split("|")
      if (!filePath || !lineNumStr || lineTextParts.length === 0) continue

      const lineNum = parseInt(lineNumStr, 10)
      const lineText = lineTextParts.join("|")

      const file = Bun.file(filePath)
      const stats = await file.stat().catch(() => null)
      if (!stats) continue

      matches.push({
        path: filePath,
        modTime: stats.mtime.getTime(),
        lineNum,
        lineText,
      })
    }

    matches.sort((a, b) => b.modTime - a.modTime)

    const limit = 100
    const truncated = matches.length > limit
    const finalMatches = truncated ? matches.slice(0, limit) : matches

    if (finalMatches.length === 0) {
      return {
        title: params.pattern,
        metadata: { matches: 0, truncated: false, timedOut: false },
        output: "No files found",
      }
    }

    const outputLines = [`Found ${finalMatches.length} matches`]

    let currentFile = ""
    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("")
        }
        currentFile = match.path
        outputLines.push(`${match.path}:`)
      }
      const truncatedLineText =
        match.lineText.length > MAX_LINE_LENGTH ? match.lineText.substring(0, MAX_LINE_LENGTH) + "..." : match.lineText
      outputLines.push(`  Line ${match.lineNum}: ${truncatedLineText}`)
    }

    if (truncated) {
      outputLines.push("")
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)")
    }

    return {
      title: params.pattern,
      metadata: {
        matches: finalMatches.length,
        truncated,
        timedOut: false,
      },
      output: outputLines.join("\n"),
    }
  },
})
