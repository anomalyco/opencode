import { createConnectTransport } from "@connectrpc/connect-web"
import { createClient, type Transport, type AnyClient } from "@connectrpc/connect"
import { SessionService } from "./gen/opencode/v1/session_connect.js"
import { ProjectService } from "./gen/opencode/v1/project_connect.js"
import { EventService } from "./gen/opencode/v1/event_connect.js"
import { FileService } from "./gen/opencode/v1/file_connect.js"
import { HealthService } from "./gen/opencode/v1/health_connect.js"
import { McpService } from "./gen/opencode/v1/mcp_connect.js"
import { PermissionService } from "./gen/opencode/v1/permission_connect.js"
import { PtyService } from "./gen/opencode/v1/pty_connect.js"
import { ConfigService } from "./gen/opencode/v1/config_connect.js"
import { ProviderService } from "./gen/opencode/v1/provider_connect.js"
import { QuestionService } from "./gen/opencode/v1/question_connect.js"
import { TuiService } from "./gen/opencode/v1/tui_connect.js"
import { ExperimentalService } from "./gen/opencode/v1/experimental_connect.js"

export type GrpcClient = {
  session: AnyClient
  project: AnyClient
  event: AnyClient
  file: AnyClient
  health: AnyClient
  mcp: AnyClient
  permission: AnyClient
  pty: AnyClient
  config: AnyClient
  provider: AnyClient
  question: AnyClient
  tui: AnyClient
  experimental: AnyClient
}

export function createGrpcClient(baseUrl: string, transport?: Transport): GrpcClient {
  const t =
    transport ??
    createConnectTransport({
      baseUrl,
    })

  return {
    // @ts-ignore - Type mismatch between generated v1 services and Client type
    session: createClient(SessionService, t),
    // @ts-ignore
    project: createClient(ProjectService, t),
    // @ts-ignore
    event: createClient(EventService, t),
    // @ts-ignore
    file: createClient(FileService, t),
    // @ts-ignore
    health: createClient(HealthService, t),
    // @ts-ignore
    mcp: createClient(McpService, t),
    // @ts-ignore
    permission: createClient(PermissionService, t),
    // @ts-ignore
    pty: createClient(PtyService, t),
    // @ts-ignore
    config: createClient(ConfigService, t),
    // @ts-ignore
    provider: createClient(ProviderService, t),
    // @ts-ignore
    question: createClient(QuestionService, t),
    // @ts-ignore
    tui: createClient(TuiService, t),
    // @ts-ignore
    experimental: createClient(ExperimentalService, t),
  }
}

export {
  SessionService,
  ProjectService,
  EventService,
  FileService,
  HealthService,
  McpService,
  PermissionService,
  PtyService,
  ConfigService,
  ProviderService,
  QuestionService,
  TuiService,
  ExperimentalService,
}
