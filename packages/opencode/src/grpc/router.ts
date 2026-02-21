import type { ConnectRouter } from "@connectrpc/connect"
import { events } from "./impl/events"
import { session } from "./impl/session"
import { project } from "./impl/project"
import { provider } from "./impl/provider"
import { config } from "./impl/config"
import { permission } from "./impl/permission"
import { question } from "./impl/question"
import { pty } from "./impl/pty"
import { file } from "./impl/file"
import { experimental } from "./impl/experimental"
import { tui } from "./impl/tui"
import { mcp } from "./impl/mcp"
import { wrapHandler, wrapStreamHandler } from "./error"
import { EventService } from "./gen/opencode/v1/event_pb"
import { HealthService } from "./gen/opencode/v1/health_pb"
import { SessionService } from "./gen/opencode/v1/session_pb"
import { ProjectService } from "./gen/opencode/v1/project_pb"
import { ProviderService } from "./gen/opencode/v1/provider_pb"
import { ConfigService } from "./gen/opencode/v1/config_pb"
import { PermissionService } from "./gen/opencode/v1/permission_pb"
import { QuestionService } from "./gen/opencode/v1/question_pb"
import { PtyService } from "./gen/opencode/v1/pty_pb"
import { FileService } from "./gen/opencode/v1/file_pb"
import { ExperimentalService } from "./gen/opencode/v1/experimental_pb"
import { TuiService } from "./gen/opencode/v1/tui_pb"
import { McpService } from "./gen/opencode/v1/mcp_pb"

export function createRouter(router: ConnectRouter) {
  router.service(HealthService, {
    check: async () => ({ healthy: true, version: "1.0.0" }),
  })

  router.service(EventService, {
    subscribe: events.subscribe,
    subscribeGlobal: events.subscribeGlobal,
  })

  router.service(SessionService, {
    prompt: wrapStreamHandler(session.prompt),
    list: wrapHandler(session.list),
    get: wrapHandler(session.get),
    create: wrapHandler(session.create),
    update: wrapHandler(session.update),
    delete: wrapHandler(session.delete),
    fork: wrapHandler(session.fork),
    getChildren: wrapHandler(session.getChildren),
    abort: wrapHandler(session.abort),
  })

  router.service(ProjectService, {
    list: wrapHandler(project.list),
    getCurrent: wrapHandler(project.getCurrent),
    update: wrapHandler(project.update),
  })

  router.service(ProviderService, {
    list: wrapHandler(provider.list),
    getAuth: wrapHandler(provider.getAuth),
    oAuthAuthorize: wrapHandler(provider.oauthAuthorize),
    oAuthCallback: wrapHandler(provider.oauthCallback),
  })

  router.service(ConfigService, {
    get: wrapHandler(config.get),
    update: wrapHandler(config.update),
  })

  router.service(PermissionService, {
    list: wrapHandler(permission.list),
    reply: wrapHandler(permission.reply),
  })

  router.service(PtyService, {
    list: wrapHandler(pty.list),
    create: wrapHandler(pty.create),
    get: wrapHandler(pty.get),
    update: wrapHandler(pty.update),
    delete: wrapHandler(pty.delete),
  })

  router.service(QuestionService, {
    list: wrapHandler(question.list),
    reply: wrapHandler(question.reply),
    reject: wrapHandler(question.reject),
  })

  router.service(FileService, {
    findText: wrapHandler(file.findText),
    findFiles: wrapHandler(file.findFiles),
    findSymbols: wrapHandler(file.findSymbols),
    listFiles: wrapHandler(file.listFiles),
    readFile: wrapHandler(file.readFile),
    getFileStatus: wrapHandler(file.getFileStatus),
  })

  router.service(ExperimentalService, {
    listToolIds: wrapHandler(experimental.listToolIds),
    listTools: wrapHandler(experimental.listTools),
    createWorktree: wrapHandler(experimental.createWorktree),
    listWorktrees: wrapHandler(experimental.listWorktrees),
    removeWorktree: wrapHandler(experimental.removeWorktree),
    resetWorktree: wrapHandler(experimental.resetWorktree),
    listGlobalSessions: wrapHandler(experimental.listGlobalSessions),
    listMcpResources: wrapHandler(experimental.listMcpResources),
  })

  router.service(TuiService, {
    appendPrompt: wrapHandler(tui.appendPrompt),
    openHelp: wrapHandler(tui.openHelp),
    openSessions: wrapHandler(tui.openSessions),
    openThemes: wrapHandler(tui.openThemes),
    openModels: wrapHandler(tui.openModels),
    submitPrompt: wrapHandler(tui.submitPrompt),
    clearPrompt: wrapHandler(tui.clearPrompt),
    executeCommand: wrapHandler(tui.executeCommand),
    showToast: wrapHandler(tui.showToast),
    selectSession: wrapHandler(tui.selectSession),
    publish: wrapHandler(tui.publish),
  })

  router.service(McpService, {
    getStatus: wrapHandler(mcp.getStatus),
    addServer: wrapHandler(mcp.addServer),
    startAuth: wrapHandler(mcp.startAuth),
    completeAuth: wrapHandler(mcp.completeAuth),
    connect: wrapHandler(mcp.connect),
    disconnect: wrapHandler(mcp.disconnect),
  })
}
