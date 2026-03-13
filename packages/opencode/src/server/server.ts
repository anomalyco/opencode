import appManifest from "./app-manifest"
import { createHash } from "node:crypto"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { proxy } from "hono/proxy"
import { basicAuth } from "hono/basic-auth"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { WorkspaceID } from "../control-plane/schema"
import { ProviderID } from "../provider/schema"
import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { EventRoutes } from "./routes/event"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { Filesystem } from "@/util/filesystem"
import { Snapshot } from "@/snapshot"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { lazy } from "@/util/lazy"
import { initProjectors } from "./projectors"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

declare global {
  // Injected at compile time by build.ts when web UI assets are embedded
  const OPENCODE_APP_EMBEDDED: boolean | undefined
}

const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src 'self' data:`

initProjectors()

export namespace Server {
  const log = Log.create({ service: "server" })

  // MIME types for static file serving
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

  const CSP =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' data:"

  // Resolve the local app directory to serve from. Returns undefined to fall
  // through to the CDN proxy. Resolution order:
  //   1. Embedded $bunfs assets (manifest imported at build time)
  //   2. OPENCODE_APP_DIR env var (explicit override)
  //   3. Auto-detect packages/app/dist/ relative to this file (monorepo dev)
  let _appDir: string | false | undefined // undefined = not yet resolved; false = not found
  function resolveAppDir(): string | undefined {
    if (_appDir !== undefined) return _appDir || undefined

    // 1. Embedded via Bun compile — manifest is non-empty when assets were embedded
    if (typeof OPENCODE_APP_EMBEDDED !== "undefined" && OPENCODE_APP_EMBEDDED) {
      _appDir = "__embedded__"
      return _appDir
    }

    // 2. Explicit env var override
    if (Flag.OPENCODE_APP_DIR) {
      _appDir = Flag.OPENCODE_APP_DIR
      return _appDir
    }

    // 3. Auto-detect: walk up from this file to find packages/app/dist
    // import.meta.url is a $bunfs URL in compiled binary, file: URL in dev
    try {
      const url = new URL("../../../app/dist", import.meta.url)
      if (url.protocol === "file:") {
        const { pathname } = url
        if (Bun.file(pathname + "/index.html").size > 0) {
          _appDir = pathname
          return _appDir
        }
      }
    } catch {}

    _appDir = false
    return undefined
  }

  // Serve an exact static file match (no SPA fallback). Used by the
  // pre-bootstrap middleware so API routes are not intercepted.
  function serveStaticFile(reqPath: string, appDir: string): Response | undefined {
    const filePath = reqPath === "/" ? "/index.html" : reqPath

    if (appDir === "__embedded__") {
      const bunfsPath = appManifest[filePath]
      if (bunfsPath) {
        const file = Bun.file(bunfsPath)
        if (file.size > 0) {
          const ext = filePath.split(".").pop() ?? ""
          return new Response(file, {
            headers: {
              "Content-Type": MIME[ext] ?? "application/octet-stream",
              "Content-Security-Policy": CSP,
            },
          })
        }
      }
      return undefined
    }

    const file = Bun.file(appDir + filePath)
    if (file.size > 0) {
      const ext = filePath.split(".").pop() ?? ""
      return new Response(file, {
        headers: {
          "Content-Type": MIME[ext] ?? "application/octet-stream",
          "Content-Security-Policy": CSP,
        },
      })
    }
    return undefined
  }

  // Serve a static file or fall back to index.html (SPA routing).
  // Used by the catch-all route after all API routes have been checked.
  function serveLocal(reqPath: string, appDir: string): Response | undefined {
    const exact = serveStaticFile(reqPath, appDir)
    if (exact) return exact

    // SPA fallback: return index.html for unmatched paths that look like page
    // routes (no file extension). Paths with extensions (e.g. .woff2, .js) are
    // asset requests that should fall through to CDN proxy if not found locally.
    if (/\.[a-zA-Z0-9]+$/.test(reqPath)) return undefined

    if (appDir === "__embedded__") {
      const indexPath = appManifest["/index.html"]
      if (indexPath) {
        const index = Bun.file(indexPath)
        if (index.size > 0) {
          return new Response(index, {
            headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP },
          })
        }
      }
      return undefined
    }

    const index = Bun.file(appDir + "/index.html")
    if (index.size > 0) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": CSP },
      })
    }
    return undefined
  }

  export const Default = lazy(() => createApp({}))

  export const createApp = (opts: { cors?: string[] }): Hono => {
    const app = new Hono()
    return app
      .onError((err, c) => {
        log.error("failed", {
          error: err,
        })
        if (err instanceof NamedError) {
          let status: ContentfulStatusCode
          if (err instanceof NotFoundError) status = 404
          else if (err instanceof Provider.ModelNotFoundError) status = 400
          else if (err.name === "ProviderAuthValidationFailed") status = 400
          else if (err.name.startsWith("Worktree")) status = 400
          else status = 500
          return c.json(err.toObject(), { status })
        }
        if (err instanceof HTTPException) return err.getResponse()
        const message = err instanceof Error && err.stack ? err.stack : err.toString()
        return c.json(new NamedError.Unknown({ message }).toObject(), {
          status: 500,
        })
      })
      .use((c, next) => {
        // Allow CORS preflight requests to succeed without auth.
        // Browser clients sending Authorization headers will preflight with OPTIONS.
        if (c.req.method === "OPTIONS") return next()
        const password = Flag.OPENCODE_SERVER_PASSWORD
        if (!password) return next()
        const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
        return basicAuth({ username, password })(c, next)
      })
      .use(async (c, next) => {
        const skipLogging = c.req.path === "/log"
        if (!skipLogging) {
          log.info("request", {
            method: c.req.method,
            path: c.req.path,
          })
        }
        const timer = log.time("request", {
          method: c.req.method,
          path: c.req.path,
        })
        await next()
        if (!skipLogging) {
          timer.stop()
        }
      })
      .use(
        cors({
          origin(input) {
            if (!input) return

            if (input.startsWith("http://localhost:")) return input
            if (input.startsWith("http://127.0.0.1:")) return input
            if (
              input === "tauri://localhost" ||
              input === "http://tauri.localhost" ||
              input === "https://tauri.localhost"
            )
              return input

            // *.opencode.ai (https only, adjust if needed)
            if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
              return input
            }
            if (opts?.cors?.includes(input)) {
              return input
            }

            return
          },
        }),
      )
      .route("/global", GlobalRoutes())
      .use(async (c, next) => {
        // Serve local/embedded web UI assets before any project bootstrap.
        // This must run before Instance.provide() to avoid the DB migration check.
        // Only serve *exact* static file matches here (no SPA fallback) — the SPA
        // fallback lives in the catch-all route at the bottom so it doesn't
        // intercept API routes like /agent, /health, etc.
        const appDir = resolveAppDir()
        if (appDir) {
          const response = serveStaticFile(c.req.path, appDir)
          if (response) return response
        }
        return next()
      })
      .put(
        "/auth/:providerID",
        describeRoute({
          summary: "Set auth credentials",
          description: "Set authentication credentials",
          operationId: "auth.set",
          responses: {
            200: {
              description: "Successfully set authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        validator("json", Auth.Info.zod),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          const info = c.req.valid("json")
          await Auth.set(providerID, info)
          return c.json(true)
        },
      )
      .delete(
        "/auth/:providerID",
        describeRoute({
          summary: "Remove auth credentials",
          description: "Remove authentication credentials",
          operationId: "auth.remove",
          responses: {
            200: {
              description: "Successfully removed authentication credentials",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "param",
          z.object({
            providerID: ProviderID.zod,
          }),
        ),
        async (c) => {
          const providerID = c.req.valid("param").providerID
          await Auth.remove(providerID)
          return c.json(true)
        },
      )
      .use(async (c, next) => {
        if (c.req.path === "/log") return next()
        const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-opencode-workspace")
        const raw = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
        const directory = Filesystem.resolve(
          (() => {
            try {
              return decodeURIComponent(raw)
            } catch {
              return raw
            }
          })(),
        )

        return WorkspaceContext.provide({
          workspaceID: rawWorkspaceID ? WorkspaceID.make(rawWorkspaceID) : undefined,
          async fn() {
            return Instance.provide({
              directory,
              init: InstanceBootstrap,
              async fn() {
                return next()
              },
            })
          },
        })
      })
      .use(WorkspaceRouterMiddleware)
      .get(
        "/doc",
        openAPIRouteHandler(app, {
          documentation: {
            info: {
              title: "opencode",
              version: "0.0.3",
              description: "opencode api",
            },
            openapi: "3.1.1",
          },
        }),
      )
      .use(
        validator(
          "query",
          z.object({
            directory: z.string().optional(),
            workspace: z.string().optional(),
          }),
        ),
      )
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
          const [branch, default_branch] = await Promise.all([Vcs.branch(), Vcs.defaultBranch()])
          return c.json({
            branch,
            default_branch,
          })
        },
      )
      .get(
        "/vcs/diff",
        describeRoute({
          summary: "Get VCS diff",
          description: "Retrieve the current git diff for the working tree or against the default branch.",
          operationId: "vcs.diff",
          responses: {
            200: {
              description: "VCS diff",
              content: {
                "application/json": {
                  schema: resolver(Snapshot.FileDiff.array()),
                },
              },
            },
          },
        }),
        validator(
          "query",
          z.object({
            mode: Vcs.Mode,
          }),
        ),
        async (c) => {
          return c.json(await Vcs.diff(c.req.valid("query").mode))
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
      .post(
        "/log",
        describeRoute({
          summary: "Write log",
          description: "Write a log entry to the server logs with specified level and metadata.",
          operationId: "app.log",
          responses: {
            200: {
              description: "Log entry written successfully",
              content: {
                "application/json": {
                  schema: resolver(z.boolean()),
                },
              },
            },
            ...errors(400),
          },
        }),
        validator(
          "json",
          z.object({
            service: z.string().meta({ description: "Service name for the log entry" }),
            level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
            message: z.string().meta({ description: "Log message" }),
            extra: z
              .record(z.string(), z.any())
              .optional()
              .meta({ description: "Additional metadata for the log entry" }),
          }),
        ),
        async (c) => {
          const { service, level, message, extra } = c.req.valid("json")
          const logger = Log.create({ service })

          switch (level) {
            case "debug":
              logger.debug(message, extra)
              break
            case "info":
              logger.info(message, extra)
              break
            case "error":
              logger.error(message, extra)
              break
            case "warn":
              logger.warn(message, extra)
              break
          }

          return c.json(true)
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
        // Try local/embedded assets with SPA fallback first
        const appDir = resolveAppDir()
        if (appDir) {
          const response = serveLocal(c.req.path, appDir)
          if (response) return response
        }

        // Fall through to CDN proxy when no local assets are available
        const path = c.req.path

        const response = await proxy(`https://app.opencode.ai${path}`, {
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
  }

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(Default(), {
      documentation: {
        info: {
          title: "opencode",
          version: "1.0.0",
          description: "opencode api",
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  /** @deprecated do not use this dumb shit */
  export let url: URL

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    url = new URL(`http://${opts.hostname}:${opts.port}`)
    const app = createApp(opts)
    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: app.fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
