import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
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
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { Storage } from "../storage/storage"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"
import { Worktree } from "../worktree"
import { Debug } from "@/debug"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  export const Event = {
    Connected: BusEvent.define("server.connected", z.object({})),
    Disposed: BusEvent.define("global.disposed", z.object({})),
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      // TODO: Break server.ts into smaller route files to fix type inference
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof Storage.NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
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
          const password = Flag.OPENCODE_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"
          return basicAuth({ username, password })(c, next)
        })
        .use(async (c, next) => {
          const skipLogging = c.req.path === "/log" || c.req.path.startsWith("/ingest/")
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
              if (input === "tauri://localhost" || input === "http://tauri.localhost") return input

              // *.opencode.ai (https only, adjust if needed)
              if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
                return input
              }
              if (_corsWhitelist.includes(input)) {
                return input
              }

              return
            },
          }),
        )
        .route("/global", GlobalRoutes())
        .use(async (c, next) => {
          let directory = c.req.query("directory") || c.req.header("x-opencode-directory") || process.cwd()
          try {
            directory = decodeURIComponent(directory)
          } catch {
            // fallback to original value
          }
          return Instance.provide({
            directory,
            init: InstanceBootstrap,
            async fn() {
              return next()
            },
          })
        })
        .post(
          "/ingest/:sessionId",
          describeRoute({
            summary: "Ingest debug logs",
            description:
              "Ingest Cursor-style debug logs (NDJSON or JSON) and append them to .opencode/debug.log in the worktree root.",
            operationId: "debug.ingest",
            responses: {
              200: {
                description: "Logs ingested",
                content: {
                  "application/json": {
                    schema: resolver(z.object({ success: z.literal(true), count: z.number().int().nonnegative() })),
                  },
                },
              },
              ...errors(400),
            },
          }),
          validator("param", z.object({ sessionId: z.string() })),
          async (c) => {
            const { sessionId } = c.req.valid("param")
            const contentType = c.req.header("content-type") ?? ""

            const raw = contentType.includes("application/json") ? await c.req.json() : await c.req.text()
            const entries = Array.isArray(raw)
              ? raw
              : typeof raw === "string"
                ? raw
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((line) => JSON.parse(line))
                : [raw]

            const lines: string[] = []
            for (const entry of entries) {
              const parsed = Debug.IngestEntry.safeParse(entry)
              if (!parsed.success) {
                return c.json(
                  {
                    success: false as const,
                    data: entry,
                    errors: parsed.error.flatten().fieldErrors,
                  },
                  400,
                )
              }
              if (parsed.data.sessionId !== sessionId) {
                return c.json(
                  {
                    success: false as const,
                    data: { sessionId: parsed.data.sessionId, pathSessionId: sessionId },
                    errors: [{ sessionId: "Body sessionId must match /ingest/:sessionId" }],
                  },
                  400,
                )
              }
              lines.push(JSON.stringify(parsed.data))
            }

            await Debug.appendLogLines({ worktreeRoot: Instance.worktree, lines })
            return c.json({ success: true as const, count: lines.length })
          },
        )
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
        .use(validator("query", z.object({ directory: z.string().optional() })))
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/", FileRoutes())
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
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
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
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
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
          "/session",
          describeRoute({
            summary: "List sessions",
            description: "Get a list of all OpenCode sessions, sorted by most recently updated.",
            operationId: "session.list",
            responses: {
              200: {
                description: "List of sessions",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info.array()),
                  },
                },
              },
            },
          }),
          validator(
            "query",
            z.object({
              directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
              roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
              start: z.coerce
                .number()
                .optional()
                .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
              search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
              limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
            }),
          ),
          async (c) => {
            const query = c.req.valid("query")
            const term = query.search?.toLowerCase()
            const sessions: Session.Info[] = []
            for await (const session of Session.list()) {
              if (query.directory !== undefined && session.directory !== query.directory) continue
              if (query.roots && session.parentID) continue
              if (query.start !== undefined && session.time.updated < query.start) continue
              if (term !== undefined && !session.title.toLowerCase().includes(term)) continue
              sessions.push(session)
              if (query.limit !== undefined && sessions.length >= query.limit) break
            }
            return c.json(sessions)
          },
        )
        .get(
          "/session/status",
          describeRoute({
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
            operationId: "session.status",
            responses: {
              200: {
                description: "Get session status",
                content: {
                  "application/json": {
                    schema: resolver(z.record(z.string(), SessionStatus.Info)),
                  },
                },
              },
              ...errors(400),
            },
          }),
          async (c) => {
            const result = SessionStatus.list()
            return c.json(result)
          },
        )
        .get(
          "/session/:sessionID",
          describeRoute({
            summary: "Get session",
            description: "Retrieve detailed information about a specific OpenCode session.",
            tags: ["Session"],
            operationId: "session.get",
            responses: {
              200: {
                description: "Get session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: Session.get.schema,
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            log.info("SEARCH", { url: c.req.url })
            const session = await Session.get(sessionID)
            return c.json(session)
          },
        )
        .get(
          "/session/:sessionID/children",
          describeRoute({
            summary: "Get session children",
            tags: ["Session"],
            description: "Retrieve all child sessions that were forked from the specified parent session.",
            operationId: "session.children",
            responses: {
              200: {
                description: "List of children",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info.array()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: Session.children.schema,
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const session = await Session.children(sessionID)
            return c.json(session)
          },
        )
        .get(
          "/session/:sessionID/todo",
          describeRoute({
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
            operationId: "session.todo",
            responses: {
              200: {
                description: "Todo list",
                content: {
                  "application/json": {
                    schema: resolver(Todo.Info.array()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const todos = await Todo.get(sessionID)
            return c.json(todos)
          },
        )
        .post(
          "/session",
          describeRoute({
            summary: "Create session",
            description: "Create a new OpenCode session for interacting with AI assistants and managing conversations.",
            operationId: "session.create",
            responses: {
              ...errors(400),
              200: {
                description: "Successfully created session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
            },
          }),
          validator("json", Session.create.schema.optional()),
          async (c) => {
            const body = c.req.valid("json") ?? {}
            const session = await Session.create(body)
            return c.json(session)
          },
        )
        .delete(
          "/session/:sessionID",
          describeRoute({
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
            operationId: "session.delete",
            responses: {
              200: {
                description: "Successfully deleted session",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: Session.remove.schema,
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.remove(sessionID)
            return c.json(true)
          },
        )
        .patch(
          "/session/:sessionID",
          describeRoute({
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
            operationId: "session.update",
            responses: {
              200: {
                description: "Successfully updated session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
            }),
          ),
          validator(
            "json",
            z.object({
              title: z.string().optional(),
              time: z
                .object({
                  archived: z.number().optional(),
                })
                .optional(),
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const updates = c.req.valid("json")

            const updatedSession = await Session.update(sessionID, (session) => {
              if (updates.title !== undefined) {
                session.title = updates.title
              }
              if (updates.time?.archived !== undefined) session.time.archived = updates.time.archived
            })

            return c.json(updatedSession)
          },
        )
        .post(
          "/session/:sessionID/init",
          describeRoute({
            summary: "Initialize session",
            description:
              "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
            operationId: "session.init",
            responses: {
              200: {
                description: "200",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator("json", Session.initialize.schema.omit({ sessionID: true })),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            await Session.initialize({ ...body, sessionID })
            return c.json(true)
          },
        )
        .post(
          "/session/:sessionID/fork",
          describeRoute({
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
            operationId: "session.fork",
            responses: {
              200: {
                description: "200",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: Session.fork.schema.shape.sessionID,
            }),
          ),
          validator("json", Session.fork.schema.omit({ sessionID: true })),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const result = await Session.fork({ ...body, sessionID })
            return c.json(result)
          },
        )
        .post(
          "/session/:sessionID/abort",
          describeRoute({
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
            operationId: "session.abort",
            responses: {
              200: {
                description: "Aborted session",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
            }),
          ),
          async (c) => {
            SessionPrompt.cancel(c.req.valid("param").sessionID)
            return c.json(true)
          },
        )

        .post(
          "/session/:sessionID/share",
          describeRoute({
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
            operationId: "session.share",
            responses: {
              200: {
                description: "Successfully shared session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.share(sessionID)
            const session = await Session.get(sessionID)
            return c.json(session)
          },
        )
        .get(
          "/session/:sessionID/diff",
          describeRoute({
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
            operationId: "session.diff",
            responses: {
              200: {
                description: "Successfully retrieved diff",
                content: {
                  "application/json": {
                    schema: resolver(Snapshot.FileDiff.array()),
                  },
                },
              },
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: SessionSummary.diff.schema.shape.sessionID,
            }),
          ),
          validator(
            "query",
            z.object({
              messageID: SessionSummary.diff.schema.shape.messageID,
            }),
          ),
          async (c) => {
            const query = c.req.valid("query")
            const params = c.req.valid("param")
            const result = await SessionSummary.diff({
              sessionID: params.sessionID,
              messageID: query.messageID,
            })
            return c.json(result)
          },
        )
        .delete(
          "/session/:sessionID/share",
          describeRoute({
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
            operationId: "session.unshare",
            responses: {
              200: {
                description: "Successfully unshared session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: Session.unshare.schema,
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            await Session.unshare(sessionID)
            const session = await Session.get(sessionID)
            return c.json(session)
          },
        )
        .post(
          "/session/:sessionID/summarize",
          describeRoute({
            summary: "Summarize session",
            description: "Generate a concise summary of the session using AI compaction to preserve key information.",
            operationId: "session.summarize",
            responses: {
              200: {
                description: "Summarized session",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator(
            "json",
            z.object({
              providerID: z.string(),
              modelID: z.string(),
              auto: z.boolean().optional().default(false),
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const session = await Session.get(sessionID)
            await SessionRevert.cleanup(session)
            const msgs = await Session.messages({ sessionID })
            let currentAgent = await Agent.defaultAgent()
            for (let i = msgs.length - 1; i >= 0; i--) {
              const info = msgs[i].info
              if (info.role === "user") {
                currentAgent = info.agent || (await Agent.defaultAgent())
                break
              }
            }
            await SessionCompaction.create({
              sessionID,
              agent: currentAgent,
              model: {
                providerID: body.providerID,
                modelID: body.modelID,
              },
              auto: body.auto,
            })
            await SessionPrompt.loop(sessionID)
            return c.json(true)
          },
        )
        .get(
          "/session/:sessionID/message",
          describeRoute({
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
            operationId: "session.messages",
            responses: {
              200: {
                description: "List of messages",
                content: {
                  "application/json": {
                    schema: resolver(MessageV2.WithParts.array()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator(
            "query",
            z.object({
              limit: z.coerce.number().optional(),
            }),
          ),
          async (c) => {
            const query = c.req.valid("query")
            const messages = await Session.messages({
              sessionID: c.req.valid("param").sessionID,
              limit: query.limit,
            })
            return c.json(messages)
          },
        )
        .get(
          "/session/:sessionID/diff",
          describeRoute({
            summary: "Get session diff",
            description: "Get all file changes (diffs) made during this session.",
            operationId: "session.diff",
            responses: {
              200: {
                description: "List of diffs",
                content: {
                  "application/json": {
                    schema: resolver(Snapshot.FileDiff.array()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          async (c) => {
            const diff = await Session.diff(c.req.valid("param").sessionID)
            return c.json(diff)
          },
        )
        .get(
          "/session/:sessionID/message/:messageID",
          describeRoute({
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
            operationId: "session.message",
            responses: {
              200: {
                description: "Message",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        info: MessageV2.Info,
                        parts: MessageV2.Part.array(),
                      }),
                    ),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
              messageID: z.string().meta({ description: "Message ID" }),
            }),
          ),
          async (c) => {
            const params = c.req.valid("param")
            const message = await MessageV2.get({
              sessionID: params.sessionID,
              messageID: params.messageID,
            })
            return c.json(message)
          },
        )
        .delete(
          "/session/:sessionID/message/:messageID/part/:partID",
          describeRoute({
            description: "Delete a part from a message",
            operationId: "part.delete",
            responses: {
              200: {
                description: "Successfully deleted part",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
              messageID: z.string().meta({ description: "Message ID" }),
              partID: z.string().meta({ description: "Part ID" }),
            }),
          ),
          async (c) => {
            const params = c.req.valid("param")
            await Session.removePart({
              sessionID: params.sessionID,
              messageID: params.messageID,
              partID: params.partID,
            })
            return c.json(true)
          },
        )
        .patch(
          "/session/:sessionID/message/:messageID/part/:partID",
          describeRoute({
            description: "Update a part in a message",
            operationId: "part.update",
            responses: {
              200: {
                description: "Successfully updated part",
                content: {
                  "application/json": {
                    schema: resolver(MessageV2.Part),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
              messageID: z.string().meta({ description: "Message ID" }),
              partID: z.string().meta({ description: "Part ID" }),
            }),
          ),
          validator("json", MessageV2.Part),
          async (c) => {
            const params = c.req.valid("param")
            const body = c.req.valid("json")
            if (
              body.id !== params.partID ||
              body.messageID !== params.messageID ||
              body.sessionID !== params.sessionID
            ) {
              throw new Error(
                `Part mismatch: body.id='${body.id}' vs partID='${params.partID}', body.messageID='${body.messageID}' vs messageID='${params.messageID}', body.sessionID='${body.sessionID}' vs sessionID='${params.sessionID}'`,
              )
            }
            const part = await Session.updatePart(body)
            return c.json(part)
          },
        )
        .post(
          "/session/:sessionID/message",
          describeRoute({
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
            operationId: "session.prompt",
            responses: {
              200: {
                description: "Created message",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        info: MessageV2.Assistant,
                        parts: MessageV2.Part.array(),
                      }),
                    ),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
          async (c) => {
            c.status(200)
            c.header("Content-Type", "application/json")
            return stream(c, async (stream) => {
              const sessionID = c.req.valid("param").sessionID
              const body = c.req.valid("json")
              const system =
                body.agent === "debug"
                  ? [
                      body.system,
                      Debug.configSystemBlock({ requestUrl: c.req.url, sessionID, worktreeRoot: Instance.worktree }),
                    ]
                      .filter(Boolean)
                      .join("\n\n")
                  : body.system
              const msg = await SessionPrompt.prompt({ ...body, system, sessionID })
              stream.write(JSON.stringify(msg))
            })
          },
        )
        .post(
          "/session/:sessionID/prompt_async",
          describeRoute({
            summary: "Send async message",
            description:
              "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
            operationId: "session.prompt_async",
            responses: {
              204: {
                description: "Prompt accepted",
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator("json", SessionPrompt.PromptInput.omit({ sessionID: true })),
          async (c) => {
            c.status(204)
            c.header("Content-Type", "application/json")
            return stream(c, async () => {
              const sessionID = c.req.valid("param").sessionID
              const body = c.req.valid("json")
              const system =
                body.agent === "debug"
                  ? [
                      body.system,
                      Debug.configSystemBlock({ requestUrl: c.req.url, sessionID, worktreeRoot: Instance.worktree }),
                    ]
                      .filter(Boolean)
                      .join("\n\n")
                  : body.system
              SessionPrompt.prompt({ ...body, system, sessionID })
            })
          },
        )
        .post(
          "/session/:sessionID/command",
          describeRoute({
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
            operationId: "session.command",
            responses: {
              200: {
                description: "Created message",
                content: {
                  "application/json": {
                    schema: resolver(
                      z.object({
                        info: MessageV2.Assistant,
                        parts: MessageV2.Part.array(),
                      }),
                    ),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator("json", SessionPrompt.CommandInput.omit({ sessionID: true })),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const msg = await SessionPrompt.command({ ...body, sessionID })
            return c.json(msg)
          },
        )
        .post(
          "/session/:sessionID/shell",
          describeRoute({
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
            operationId: "session.shell",
            responses: {
              200: {
                description: "Created message",
                content: {
                  "application/json": {
                    schema: resolver(MessageV2.Assistant),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string().meta({ description: "Session ID" }),
            }),
          ),
          validator("json", SessionPrompt.ShellInput.omit({ sessionID: true })),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const body = c.req.valid("json")
            const msg = await SessionPrompt.shell({ ...body, sessionID })
            return c.json(msg)
          },
        )
        .post(
          "/session/:sessionID/revert",
          describeRoute({
            summary: "Revert message",
            description:
              "Revert a specific message in a session, undoing its effects and restoring the previous state.",
            operationId: "session.revert",
            responses: {
              200: {
                description: "Updated session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
            }),
          ),
          validator("json", SessionRevert.RevertInput.omit({ sessionID: true })),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            log.info("revert", c.req.valid("json"))
            const session = await SessionRevert.revert({
              sessionID,
              ...c.req.valid("json"),
            })
            return c.json(session)
          },
        )
        .post(
          "/session/:sessionID/unrevert",
          describeRoute({
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
            operationId: "session.unrevert",
            responses: {
              200: {
                description: "Updated session",
                content: {
                  "application/json": {
                    schema: resolver(Session.Info),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
            }),
          ),
          async (c) => {
            const sessionID = c.req.valid("param").sessionID
            const session = await SessionRevert.unrevert({ sessionID })
            return c.json(session)
          },
        )
        .post(
          "/session/:sessionID/permissions/:permissionID",
          describeRoute({
            summary: "Respond to permission",
            deprecated: true,
            description: "Approve or deny a permission request from the AI assistant.",
            operationId: "permission.respond",
            responses: {
              200: {
                description: "Permission processed successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              sessionID: z.string(),
              permissionID: z.string(),
            }),
          ),
          validator("json", z.object({ response: PermissionNext.Reply })),
          async (c) => {
            const params = c.req.valid("param")
            PermissionNext.reply({
              requestID: params.permissionID,
              reply: c.req.valid("json").response,
            })
            return c.json(true)
          },
        )
        .post(
          "/permission/:requestID/reply",
          describeRoute({
            summary: "Respond to permission request",
            description: "Approve or deny a permission request from the AI assistant.",
            operationId: "permission.reply",
            responses: {
              200: {
                description: "Permission processed successfully",
                content: {
                  "application/json": {
                    schema: resolver(z.boolean()),
                  },
                },
              },
              ...errors(400, 404),
            },
          }),
          validator(
            "param",
            z.object({
              requestID: z.string(),
            }),
          ),
          validator("json", z.object({ reply: PermissionNext.Reply, message: z.string().optional() })),
          async (c) => {
            const params = c.req.valid("param")
            const json = c.req.valid("json")
            await PermissionNext.reply({
              requestID: params.requestID,
              reply: json.reply,
              message: json.message,
            })
            return c.json(true)
          },
        )
        .get(
          "/permission",
          describeRoute({
            summary: "List pending permissions",
            description: "Get all pending permission requests across all sessions.",
            operationId: "permission.list",
            responses: {
              200: {
                description: "List of pending permissions",
                content: {
                  "application/json": {
                    schema: resolver(PermissionNext.Request.array()),
                  },
                },
              },
            },
          }),
          async (c) => {
            const permissions = await PermissionNext.list()
            return c.json(permissions)
          },
        )
        .route("/question", QuestionRoute)
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
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            await Auth.set(providerID, info)
            return c.json(true)
          },
        )
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            return streamSSE(c, async (stream) => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.connected",
                  properties: {},
                }),
              })
              const unsub = Bus.subscribeAll(async (event) => {
                await stream.writeSSE({
                  data: JSON.stringify(event),
                })
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 30s to prevent WKWebView timeout (60s default)
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 30000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        .all("/*", async (c) => {
          const path = c.req.path
          const response = await proxy(`https://app.opencode.ai${path}`, {
            ...c.req,
            headers: {
              ...c.req.raw.headers,
              host: "app.opencode.ai",
            },
          })
          response.headers.set(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'",
          )
          return response
        }) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
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

  export function listen(opts: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
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

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, `opencode-${server.port!}`)
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
