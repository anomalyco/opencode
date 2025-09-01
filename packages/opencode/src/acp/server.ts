import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { Installation } from "../installation"
import { Session } from "../session"
import { ToolRegistry } from "../tool/registry"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { z } from "zod"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export namespace ACPServer {
  const log = Log.create({ service: "acp" })

  const RpcReq = z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string(),
    params: z.unknown().optional(),
  })

  let sid: string | undefined

  function write(obj: Json) {
    const out = JSON.stringify(obj)
    process.stdout.write(out + "\n")
  }

  async function ensureSession() {
    if (sid) return sid
    const s = await Session.create(undefined, "Zed ACP Session")
    sid = s.id
    return sid
  }

  async function handle(method: string, params: any) {
    if (method === "initialize") {
      const info = {
        name: "opencode",
        version: Installation.VERSION,
        capabilities: {
          text: { complete: true },
          tool: { list: true, run: true },
          files: { read: true, write: true },
          fs: { glob: true },
          session: { start: true, stop: true },
          diagnostics: { log: true },
        },
      }
      return info
    }

    if (method === "shutdown") return true

    if (method === "session/start") {
      const input = z
        .object({ title: z.string().optional() })
        .catch(() => ({ title: undefined }))
        .parse(params ?? {})
      const s = await Session.create(undefined, input.title ?? "Zed ACP Session")
      sid = s.id
      return { id: s.id }
    }

    if (method === "session/stop") {
      const input = z
        .object({ id: z.string().optional() })
        .catch(() => ({ id: sid }))
        .parse(params ?? {})
      const id = input.id ?? sid
      if (!id) return { ok: true }
      await Session.remove(id).catch(() => {})
      if (sid === id) sid = undefined
      return { ok: true }
    }

    if (method === "diagnostics/log") {
      const input = z
        .object({ level: z.string().optional(), message: z.string(), data: z.record(z.any()).optional() })
        .parse(params ?? {})
      const lvl = (input.level ?? "info").toUpperCase()
      if (lvl === "DEBUG") log.debug(input.message, input.data ?? {})
      if (lvl === "INFO") log.info(input.message, input.data ?? {})
      if (lvl === "WARN") log.warn(input.message, input.data ?? {})
      if (lvl === "ERROR") log.error(input.message, input.data ?? {})
      return { ok: true }
    }

    if (method === "fs/glob") {
      const input = z.object({ pattern: z.string(), path: z.string().optional() }).parse(params ?? {})
      const glob = await (await import("../tool/glob")).GlobTool.init()
      const res = await glob.execute({ pattern: input.pattern, path: input.path }, {
        sessionID: await ensureSession(),
        messageID: Identifier.ascending("message"),
        agent: "build",
        abort: AbortSignal.any([]),
        metadata: () => {},
      })
      const list = res.output.split("\n").filter((x) => x && !x.startsWith("(Results"))
      return { paths: list }
    }

    if (method === "files/read") {
      const input = z.object({ path: z.string() }).parse(params ?? {})
      const f = Bun.file(input.path)
      const ok = await f.exists()
      if (!ok) return { content: null }
      const text = await f.text()
      return { content: text }
    }

    if (method === "files/write") {
      const input = z.object({ path: z.string(), content: z.string() }).parse(params ?? {})
      await Bun.write(input.path, input.content)
      return { ok: true }
    }

    if (method === "tool/list") {
      const def = await Provider.defaultModel()
      const tools = await ToolRegistry.tools(def.providerID, def.modelID)
      const set = new Set(["read", "write", "glob", "bash", "webfetch"])
      const list = tools
        .filter((t) => set.has(t.id))
        .map((t) => ({ name: t.id, description: t.description, parameters: t.parameters }))
      return { tools: list }
    }

    if (method === "tool/run") {
      const input = z
        .object({ name: z.string(), args: z.any().optional(), sessionId: z.string().optional() })
        .parse(params ?? {})
      const def = await Provider.defaultModel()
      const tools = await ToolRegistry.tools(def.providerID, def.modelID)
      const t = tools.find((x) => x.id === input.name)
      if (!t) return { output: "unknown tool" }
      const res = await t.execute(input.args ?? {}, {
        sessionID: input.sessionId ?? (await ensureSession()),
        messageID: Identifier.ascending("message"),
        agent: "build",
        abort: AbortSignal.any([]),
        metadata: () => {},
      })
      return { output: res.output, title: res.title, metadata: res.metadata }
    }

    if (method === "text/complete") {
      const input = z
        .object({ text: z.string(), sessionId: z.string().optional(), agent: z.string().optional() })
        .parse(params ?? {})
      const id = input.sessionId ?? (await ensureSession())
      const res = await Session.prompt({
        sessionID: id,
        agent: input.agent ?? "build",
        parts: [
          {
            type: "text",
            text: input.text,
          },
        ],
      })
      const text = res.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).text as string)
        .join("\n")
      return { text }
    }

    return { ok: false }
  }

  export async function start() {
    await Instance.provide(process.cwd(), async () => {
      log.info("starting", { cwd: process.cwd() })
      const reader = process.stdin
      reader.setEncoding("utf8")

      let buf = ""
      reader.on("data", async (chunk: string) => {
        buf += chunk
        const parts = buf.split("\n")
        buf = parts.pop() ?? ""
        for (const line of parts) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let msg: z.infer<typeof RpcReq> | undefined
          try {
            const parsed = JSON.parse(trimmed)
            const r = RpcReq.safeParse(parsed)
            if (!r.success) continue
            msg = r.data
          } catch (_) {
            continue
          }
          const result = await handle(msg.method, msg.params)
          if (msg.id === undefined) continue
          write({ jsonrpc: "2.0", id: msg.id, result })
          if (msg.method === "shutdown") process.exit(0)
        }
      })
    })
  }
}

