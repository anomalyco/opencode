import { create } from "@bufbuild/protobuf"
import { PermissionNext } from "@/permission/next"
import {
  PermissionRequestSchema,
  PermissionRequestToolSchema,
  type ListPermissionsRequest,
  type ReplyToPermissionRequest,
} from "../gen/opencode/v1/permission_pb"

function toProtoPermissionRequest(info: PermissionNext.Request) {
  return create(PermissionRequestSchema, {
    id: info.id,
    sessionId: info.sessionID,
    permission: info.permission,
    patterns: info.patterns,
    metadata: info.metadata,
    always: info.always,
    tool: info.tool
      ? create(PermissionRequestToolSchema, {
          messageId: info.tool.messageID,
          callId: info.tool.callID,
        })
      : undefined,
  })
}

export const permission = {
  async list(_req: ListPermissionsRequest) {
    const permissions = await PermissionNext.list()
    return {
      permissions: permissions.map(toProtoPermissionRequest),
    }
  },

  async reply(req: ReplyToPermissionRequest) {
    const validReplies: PermissionNext.Reply[] = ["once", "always", "reject"]
    if (!validReplies.includes(req.reply as PermissionNext.Reply)) {
      throw new Error(`Invalid permission reply: ${req.reply}. Must be one of: once, always, reject`)
    }
    await PermissionNext.reply({
      requestID: req.requestId,
      reply: req.reply as PermissionNext.Reply,
      message: req.message,
    })
    return { success: true }
  },
}
