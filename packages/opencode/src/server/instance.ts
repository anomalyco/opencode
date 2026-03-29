import { describeRoute, resolver } from "hono-openapi"
import { Hono } from "hono"
import { proxy } from "hono/proxy"
import z from "zod"
import { createHash } from "node:crypto"
import { Log } from "../util/log"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Global } from "../global"
import { LSP } from "../lsp"
import { Command } from "../command"
import { Flag } from "../flag/flag"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { EventRoutes } from "./routes/event"
import { errorHandler } from "./middleware"

const log = Log.create({ service: "server" })

export const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:"

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "application/javascript",
  mjs: "application/javascript",
  css: "text/css",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  wasm: "application/wasm",
  txt: "text/plain",
  webmanifest: "application/manifest+json",
}

function mime(path: string) {
  return MIME[path.split(".").pop() ?? ""] ?? "application/octet-stream"
}

// Resolve local app directory for dev. Resolution order:
//   1. OPENCODE_APP_DIR env var (explicit override)
//   2. Auto-detect packages/app/dist relative to this file (monorepo dev)
// Embedded assets are handled separately via embeddedUIPromise.
let _appDir: string | false | undefined
export function resolveAppDir(): string | undefined {
  if (_appDir !== undefined) return _appDir || undefined
  if (Flag.OPENCODE_APP_DIR) {
    _appDir = Flag.OPENCODE_APP_DIR
    return _appDir
  }
  try {
    const url = new URL("../../../app/dist", import.meta.url)
    if (url.protocol === "file:" && Bun.file(url.pathname + "/index.html").size > 0) {
      _appDir = url.pathname
      return _appDir
    }
  } catch {}
  _appDir = false
  return undefined
}

export function serveEmbedded(reqPath: string, manifest: Record<string, string>): Response | undefined {
  const key = reqPath === "/" ? "index.html" : reqPath.replace(/^\//, "")
  const bunfs = manifest[key]
  if (!bunfs) return undefined
  const file = Bun.file(bunfs)
  if (file.size > 0)
    return new Response(file, {
      headers: { "Content-Type": mime(key), "Content-Security-Policy": CSP },
    })
  return undefined
}

export function serveFile(reqPath: string, dir: string): Response | undefined {
  const rel = reqPath === "/" ? "/index.html" : reqPath
  const file = Bun.file(dir + rel)
  if (file.size > 0)
    return new Response(file, {
      headers: { "Content-Type": mime(rel), "Content-Security-Policy": CSP },
    })
  return undefined
}

export const InstanceRoutes = (app?: Hono) =>
  (app ?? new Hono())
    .onError(errorHandler(log))
    .route("/project", ProjectRoutes())
    .route("/pty", PtyRoutes())
    .route("/config", ConfigRoutes())
    .route("/experimental", ExperimentalRoutes())
    .route("/session", SessionRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .route("/provider", ProviderRoutes())
    .route("/", FileRoutes())
    .route("/", EventRoutes())
    .route("/mcp", McpRoutes())
    .route("/tui", TuiRoutes())
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.dispose()
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the OpenCode instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const branch = await Vcs.branch()
        return c.json({
          branch,
        })
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the OpenCode system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the OpenCode system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    )
    .get(
      "/skill",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the OpenCode system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )
    .all("/*", async (c) => {
      const embedded = await embeddedUIPromise
      const reqPath = c.req.path

      // Try embedded asset
      if (embedded) {
        const res = serveEmbedded(reqPath, embedded)
        if (res) return res
      }

      // Try local app dir
      const dir = resolveAppDir()
      if (dir) {
        const res = serveFile(reqPath, dir)
        if (res) return res
      }

      // SPA fallback: return index.html for page routes (no file extension).
      // Asset requests (.js, .css, .woff2) skip this and fall through to CDN.
      if (!/\.[a-zA-Z0-9]+$/.test(reqPath)) {
        if (embedded) {
          const idx = serveEmbedded("/index.html", embedded)
          if (idx) return idx
        }
        if (dir) {
          const idx = serveFile("/index.html", dir)
          if (idx) return idx
        }
      }

      // CDN proxy fallback for missing assets
      const response = await proxy(`https://app.opencode.ai${reqPath}`, {
        ...c.req,
        headers: {
          ...c.req.raw.headers,
          host: "app.opencode.ai",
        },
      })
      const match = response.headers.get("content-type")?.includes("text/html")
        ? (await response.clone().text()).match(
            /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
          )
        : undefined
      const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
      response.headers.set("Content-Security-Policy", csp(hash))
      return response
    })
