import z from "zod"
import { createHash } from "node:crypto"
import { trace, SpanStatusCode } from "@opentelemetry/api"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./pyodide.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import { Flag } from "@/flag/flag.ts"
import { PyodideBridge } from "@/session/pyodide-bridge"
import { Truncate } from "./truncation"
import type { MessageID, SessionID } from "@/session/schema"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "pyodide-tool" })

async function run(
  sessionID: SessionID,
  messageID: MessageID,
  callID: string,
  code: string,
  timeout: number,
  workdir?: string,
) {
  return PyodideBridge.run({
    sessionID,
    messageID,
    callID,
    code,
    timeout,
    ...(workdir !== undefined ? { workdir } : {}),
  })
}

export const PyodideTool = Tool.define("pyodide", async () => ({
  description: DESCRIPTION.replaceAll("${workspace}", Instance.workspace)
    .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
    .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
  parameters: z.object({
    code: z
      .string()
      .describe("Python source executed in the connected browser with Pyodide (WASM), not on the API host."),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    workdir: z
      .string()
      .describe(
        `Directory relative to ${Instance.workspace} (permission path only). The browser has no server filesystem; ignored at runtime.`,
      )
      .optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description in 5-10 words, e.g. 'Prints JSON health payload' for code that prints JSON.",
      ),
  }),
  async execute(params, ctx) {
    const tracer = trace.getTracer("veritly-session")
    return tracer.startActiveSpan("pyodide.execute", async (span) => {
      const t0 = Date.now()
      const hash = createHash("sha256").update(params.code).digest("hex").slice(0, 16)
      span.setAttribute("veritly.tool.name", "pyodide")
      span.setAttribute("veritly.tool.code_sha256_prefix", hash)

      if (!ctx.callID) {
        throw new Error("pyodide tool requires a tool call id (browser handshake).")
      }

      try {
        if (params.timeout !== undefined && params.timeout < 0) {
          throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
        }
        const timeout = params.timeout ?? DEFAULT_TIMEOUT

        const base = Instance.workspace
        const target = params.workdir ? path.resolve(base, params.workdir) : base
        const real = await fs.realpath(target).catch(() => "")
        if (real && !Instance.containsPath(real)) {
          const dir = (await Filesystem.isDir(real)) ? real : path.dirname(real)
          const globs = [dir.startsWith("/") ? `${dir.replace(/[\\/]+$/, "")}/*` : path.join(dir, "*")]
          await ctx.ask({
            permission: "external_directory",
            patterns: globs,
            always: globs,
            metadata: {},
          })
        }

        await ctx.ask({
          permission: "pyodide",
          patterns: [params.code],
          always: [params.code],
          metadata: {},
        })

        let wd: string | undefined
        if (params.workdir && params.workdir !== base && real) {
          wd = path.relative(base, real) || "."
        }

        const result = await run(ctx.sessionID, ctx.messageID, ctx.callID, params.code, timeout, wd)

        let output = result.output
        const meta: string[] = []
        if (result.exitCode === 124) {
          meta.push(`pyodide tool terminated after exceeding timeout ${timeout} ms`)
        }
        if (meta.length) {
          output += "\n\n<pyodide_metadata>\n" + meta.join("\n") + "\n</pyodide_metadata>"
        }

        span.setAttribute("process.exit_code", result.exitCode)
        return {
          title: params.description,
          metadata: {
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            exit: result.exitCode,
            description: params.description,
          },
          output,
        }
      } catch (e) {
        span.recordException(e as Error)
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw e
      } finally {
        span.setAttribute("veritly.tool.duration_ms", Date.now() - t0)
      }
    })
  },
}))
