import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode } from "@opencode-ai/client/promise"
import type {
  AgentApi,
  CatalogApi,
  CommandApi,
  EventApi,
  FileApi,
  IntegrationApi,
  McpApi,
  MessageApi,
  PathApi,
  PermissionApi,
  ProjectApi,
  PtyApi,
  QuestionApi,
  ReferenceApi,
  SessionApi,
  VcsApi,
} from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
  })
}

export interface ServerApi extends CatalogApi {
  readonly agent: AgentApi
  readonly command: CommandApi
  readonly event: EventApi
  readonly file: FileApi
  readonly integration: IntegrationApi
  readonly mcp: McpApi
  readonly message: MessageApi
  readonly path: PathApi
  readonly permission: PermissionApi
  readonly project: ProjectApi
  readonly pty: PtyApi
  readonly question: QuestionApi
  readonly reference: ReferenceApi
  readonly session: SessionApi
  readonly vcs: VcsApi
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): ServerApi {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}
