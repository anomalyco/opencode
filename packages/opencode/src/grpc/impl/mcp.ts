import { create } from "@bufbuild/protobuf"
import { MCP } from "../../mcp"
import { Config } from "../../config/config"
import {
  McpStatusSchema,
  McpStatusConnectedSchema,
  McpStatusDisabledSchema,
  McpStatusFailedSchema,
  McpStatusNeedsAuthSchema,
  McpStatusNeedsClientRegistrationSchema,
  GetMcpStatusResponseSchema,
  AddServerResponseSchema,
  StartAuthResponseSchema,
  CompleteAuthResponseSchema,
  ConnectResponseSchema,
  DisconnectResponseSchema,
  type GetMcpStatusRequest,
  type AddServerRequest,
  type StartAuthRequest,
  type CompleteAuthRequest,
  type ConnectRequest,
  type DisconnectRequest,
} from "../gen/opencode/v1/mcp_pb"

function toProtoStatus(status: MCP.Status) {
  switch (status.status) {
    case "connected":
      return create(McpStatusSchema, {
        statusType: {
          case: "connected",
          value: create(McpStatusConnectedSchema, { status: "connected" }),
        },
      })
    case "disabled":
      return create(McpStatusSchema, {
        statusType: {
          case: "disabled",
          value: create(McpStatusDisabledSchema, { status: "disabled" }),
        },
      })
    case "failed":
      return create(McpStatusSchema, {
        statusType: {
          case: "failed",
          value: create(McpStatusFailedSchema, {
            status: "failed",
            error: status.error,
          }),
        },
      })
    case "needs_auth":
      return create(McpStatusSchema, {
        statusType: {
          case: "needsAuth",
          value: create(McpStatusNeedsAuthSchema, { status: "needs_auth" }),
        },
      })
    case "needs_client_registration":
      return create(McpStatusSchema, {
        statusType: {
          case: "needsClientRegistration",
          value: create(McpStatusNeedsClientRegistrationSchema, {
            status: "needs_client_registration",
            error: status.error,
          }),
        },
      })
  }
}

type McpConfigType = Config.Mcp
type McpOAuthType = Config.McpOAuth

function fromProtoConfig(proto: NonNullable<AddServerRequest["config"]>): McpConfigType {
  if (proto.case === "local") {
    return {
      type: "local",
      command: proto.value.command,
      environment: proto.value.environment,
      enabled: proto.value.enabled,
      timeout: proto.value.timeout,
    }
  }
  const r = proto.value as {
    url: string
    enabled?: boolean
    headers: Record<string, string>
    timeout?: number
    oauth?: { case: string; value: any }
  }
  let oauth: Extract<McpConfigType, { type: "remote" }>["oauth"]
  const oauthField = r.oauth
  if (oauthField?.case === "oauthConfig") {
    oauth = {
      clientId: oauthField.value.clientId,
      clientSecret: oauthField.value.clientSecret,
      scope: oauthField.value.scope,
    }
  } else if (oauthField?.case === "oauthDisabled") {
    oauth = false
  }
  return {
    type: "remote",
    url: r.url,
    enabled: r.enabled,
    headers: r.headers,
    oauth,
    timeout: r.timeout,
  }
}

export const mcp = {
  async getStatus(_req: GetMcpStatusRequest) {
    const status = await MCP.status()
    const servers: Record<string, ReturnType<typeof toProtoStatus>> = {}
    for (const [name, s] of Object.entries(status)) {
      servers[name] = toProtoStatus(s)
    }
    return create(GetMcpStatusResponseSchema, { servers })
  },

  async addServer(req: AddServerRequest) {
    if (!req.config) {
      throw new Error("MCP server config is required in AddServerRequest")
    }
    const config = fromProtoConfig(req.config)
    const result = await MCP.add(req.name, config)
    const servers: Record<string, ReturnType<typeof toProtoStatus>> = {}
    for (const [name, s] of Object.entries(result.status)) {
      servers[name] = toProtoStatus(s as MCP.Status)
    }
    return create(AddServerResponseSchema, { servers })
  },

  async startAuth(req: StartAuthRequest) {
    const supportsOAuth = await MCP.supportsOAuth(req.name)
    if (!supportsOAuth) {
      throw new Error(`MCP server "${req.name}" does not support OAuth authentication`)
    }
    const result = await MCP.startAuth(req.name)
    return create(StartAuthResponseSchema, {
      authorizationUrl: result.authorizationUrl,
    })
  },

  async completeAuth(req: CompleteAuthRequest) {
    const status = await MCP.finishAuth(req.name, req.code)
    return create(CompleteAuthResponseSchema, {
      status: toProtoStatus(status),
    })
  },

  async connect(req: ConnectRequest) {
    await MCP.connect(req.name)
    return create(ConnectResponseSchema, { success: true })
  },

  async disconnect(req: DisconnectRequest) {
    await MCP.disconnect(req.name)
    return create(DisconnectResponseSchema, { success: true })
  },
}
