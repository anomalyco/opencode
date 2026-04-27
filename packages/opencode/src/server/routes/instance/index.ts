import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
import type { UpgradeWebSocket } from "hono/ws"
import { Context, Effect } from "effect"
import z from "zod"
import { Format } from "@/format"
import { TuiRoutes } from "./tui"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project"
import { Agent } from "@/agent/agent"
import { Skill } from "@/skill"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp"
import { Command } from "@/command"
import { QuestionRoutes } from "./question"
import { PermissionRoutes } from "./permission"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ExperimentalHttpApiServer } from "./httpapi/server"
import { PtyPaths } from "./httpapi/pty"
import { EventPaths } from "./httpapi/event"
import { ExperimentalPaths } from "./httpapi/experimental"
import { FilePaths } from "./httpapi/file"
import { InstancePaths } from "./httpapi/instance"
import { McpPaths } from "./httpapi/mcp"
import { SessionPaths } from "./httpapi/session"
import { SyncPaths } from "./httpapi/sync"
import { TuiPaths } from "./httpapi/tui"
import { ProjectRoutes } from "./project"
import { SessionRoutes } from "./session"
import { PtyRoutes } from "./pty"
import { McpRoutes } from "./mcp"
import { FileRoutes } from "./file"
import { ConfigRoutes } from "./config"
import { ExperimentalRoutes } from "./experimental"
import { ProviderRoutes } from "./provider"
import { EventRoutes } from "./event"
import { SyncRoutes } from "./sync"
import { InstanceMiddleware } from "./middleware"
import { jsonRequest } from "./trace"

export const InstanceRoutes = (upgrade: UpgradeWebSocket): Hono => {
  const app = new Hono()

  if (Flag.OPENCODE_EXPERIMENTAL_HTTPAPI) {
    const handler = ExperimentalHttpApiServer.webHandler().handler
    const context = Context.empty() as Context.Context<unknown>
    app.get(EventPaths.event, (c) => handler(c.req.raw, context))
    app.get("/question", (c) => handler(c.req.raw, context))
    app.post("/question/:requestID/reply", (c) => handler(c.req.raw, context))
    app.post("/question/:requestID/reject", (c) => handler(c.req.raw, context))
    app.get("/permission", (c) => handler(c.req.raw, context))
    app.post("/permission/:requestID/reply", (c) => handler(c.req.raw, context))
    app.get("/config", (c) => handler(c.req.raw, context))
    app.patch("/config", (c) => handler(c.req.raw, context))
    app.get("/config/providers", (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.console, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.consoleOrgs, (c) => handler(c.req.raw, context))
    app.post(ExperimentalPaths.consoleSwitch, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.tool, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.toolIDs, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.worktree, (c) => handler(c.req.raw, context))
    app.post(ExperimentalPaths.worktree, (c) => handler(c.req.raw, context))
    app.delete(ExperimentalPaths.worktree, (c) => handler(c.req.raw, context))
    app.post(ExperimentalPaths.worktreeReset, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.session, (c) => handler(c.req.raw, context))
    app.get(ExperimentalPaths.resource, (c) => handler(c.req.raw, context))
    app.get("/provider", (c) => handler(c.req.raw, context))
    app.get("/provider/auth", (c) => handler(c.req.raw, context))
    app.post("/provider/:providerID/oauth/authorize", (c) => handler(c.req.raw, context))
    app.post("/provider/:providerID/oauth/callback", (c) => handler(c.req.raw, context))
    app.get("/project", (c) => handler(c.req.raw, context))
    app.get("/project/current", (c) => handler(c.req.raw, context))
    app.post("/project/git/init", (c) => handler(c.req.raw, context))
    app.patch("/project/:projectID", (c) => handler(c.req.raw, context))
    app.get(FilePaths.findText, (c) => handler(c.req.raw, context))
    app.get(FilePaths.findFile, (c) => handler(c.req.raw, context))
    app.get(FilePaths.findSymbol, (c) => handler(c.req.raw, context))
    app.get(FilePaths.list, (c) => handler(c.req.raw, context))
    app.get(FilePaths.content, (c) => handler(c.req.raw, context))
    app.get(FilePaths.status, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.path, (c) => handler(c.req.raw, context))
    app.post(InstancePaths.dispose, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.vcs, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.vcsDiff, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.command, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.agent, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.skill, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.lsp, (c) => handler(c.req.raw, context))
    app.get(InstancePaths.formatter, (c) => handler(c.req.raw, context))
    app.get(McpPaths.status, (c) => handler(c.req.raw, context))
    app.post(McpPaths.status, (c) => handler(c.req.raw, context))
    app.post(McpPaths.auth, (c) => handler(c.req.raw, context))
    app.post(McpPaths.authCallback, (c) => handler(c.req.raw, context))
    app.post(McpPaths.authAuthenticate, (c) => handler(c.req.raw, context))
    app.delete(McpPaths.auth, (c) => handler(c.req.raw, context))
    app.post(McpPaths.connect, (c) => handler(c.req.raw, context))
    app.post(McpPaths.disconnect, (c) => handler(c.req.raw, context))
    app.post(SyncPaths.start, (c) => handler(c.req.raw, context))
    app.post(SyncPaths.replay, (c) => handler(c.req.raw, context))
    app.post(SyncPaths.history, (c) => handler(c.req.raw, context))
    app.get(PtyPaths.list, (c) => handler(c.req.raw, context))
    app.post(PtyPaths.create, (c) => handler(c.req.raw, context))
    app.get(PtyPaths.get, (c) => handler(c.req.raw, context))
    app.put(PtyPaths.update, (c) => handler(c.req.raw, context))
    app.delete(PtyPaths.remove, (c) => handler(c.req.raw, context))
    app.get(PtyPaths.connect, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.list, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.status, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.get, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.children, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.todo, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.diff, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.messages, (c) => handler(c.req.raw, context))
    app.get(SessionPaths.message, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.create, (c) => handler(c.req.raw, context))
    app.delete(SessionPaths.remove, (c) => handler(c.req.raw, context))
    app.patch(SessionPaths.update, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.init, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.fork, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.abort, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.share, (c) => handler(c.req.raw, context))
    app.delete(SessionPaths.share, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.summarize, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.prompt, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.promptAsync, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.command, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.shell, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.revert, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.unrevert, (c) => handler(c.req.raw, context))
    app.post(SessionPaths.permissions, (c) => handler(c.req.raw, context))
    app.delete(SessionPaths.deleteMessage, (c) => handler(c.req.raw, context))
    app.delete(SessionPaths.deletePart, (c) => handler(c.req.raw, context))
    app.patch(SessionPaths.updatePart, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.appendPrompt, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.openHelp, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.openSessions, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.openThemes, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.openModels, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.submitPrompt, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.clearPrompt, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.executeCommand, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.showToast, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.publish, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.selectSession, (c) => handler(c.req.raw, context))
    app.get(TuiPaths.controlNext, (c) => handler(c.req.raw, context))
    app.post(TuiPaths.controlResponse, (c) => handler(c.req.raw, context))
  }

  return app
    .route("/project", ProjectRoutes())
    .route("/pty", PtyRoutes(upgrade))
    .route("/config", ConfigRoutes())
    .route("/experimental", ExperimentalRoutes())
    .route("/session", SessionRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .route("/provider", ProviderRoutes())
    .route("/sync", SyncRoutes())
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
                schema: resolver(Vcs.Info.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.vcs.get", c, function* () {
          const vcs = yield* Vcs.Service
          const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], {
            concurrency: 2,
          })
          return { branch, default_branch }
        }),
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
                schema: resolver(Vcs.FileDiff.zod.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          mode: Vcs.Mode.zod,
        }),
      ),
      async (c) =>
        jsonRequest("InstanceRoutes.vcs.diff", c, function* () {
          const vcs = yield* Vcs.Service
          return yield* vcs.diff(c.req.valid("query").mode)
        }),
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
                schema: resolver(Command.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.command.list", c, function* () {
          const svc = yield* Command.Service
          return yield* svc.list()
        }),
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
                schema: resolver(Agent.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.agent.list", c, function* () {
          const svc = yield* Agent.Service
          return yield* svc.list()
        }),
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
                schema: resolver(Skill.Info.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.skill.list", c, function* () {
          const skill = yield* Skill.Service
          return yield* skill.all()
        }),
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
                schema: resolver(LSP.Status.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.lsp.status", c, function* () {
          const lsp = yield* LSP.Service
          return yield* lsp.status()
        }),
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
                schema: resolver(Format.Status.zod.array()),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("InstanceRoutes.formatter.status", c, function* () {
          const svc = yield* Format.Service
          return yield* svc.status()
        }),
    )
}
