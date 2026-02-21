import { create } from "@bufbuild/protobuf"
import { zodToJsonSchema } from "zod-to-json-schema"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { Session } from "../../session"
import {
  ListToolIdsResponseSchema,
  ListToolsResponseSchema,
  ToolSchema,
  CreateWorktreeResponseSchema,
  WorktreeSchema,
  ListWorktreesResponseSchema,
  RemoveWorktreeResponseSchema,
  ResetWorktreeResponseSchema,
  ListGlobalSessionsResponseSchema,
  GlobalSessionSchema,
  GlobalSessionProjectSchema,
  ListMcpResourcesResponseSchema,
  McpResourceSchema,
  type ListToolIdsRequest,
  type ListToolsRequest,
  type CreateWorktreeRequest,
  type ListWorktreesRequest,
  type RemoveWorktreeRequest,
  type ResetWorktreeRequest,
  type ListGlobalSessionsRequest,
  type ListMcpResourcesRequest,
} from "../gen/opencode/v1/experimental_pb"
import {
  SessionSummarySchema,
  SessionShareSchema,
  SessionTimeSchema,
  SessionRevertSchema,
} from "../gen/opencode/v1/session_pb"
import { PermissionRuleSchema, PermissionAction } from "../gen/opencode/v1/common_pb"

function toProtoPermissionRule(rules: Session.Info["permission"]) {
  if (!rules) return []
  return rules.map((rule) =>
    create(PermissionRuleSchema, {
      permission: rule.permission,
      pattern: rule.pattern,
      action:
        rule.action === "allow"
          ? PermissionAction.ALLOW
          : rule.action === "deny"
            ? PermissionAction.DENY
            : PermissionAction.ASK,
    }),
  )
}

function toProtoGlobalSession(info: Session.GlobalInfo) {
  const summary = info.summary
    ? create(SessionSummarySchema, {
        additions: BigInt(info.summary.additions),
        deletions: BigInt(info.summary.deletions),
        files: BigInt(info.summary.files),
      })
    : undefined

  const share = info.share
    ? create(SessionShareSchema, {
        url: info.share.url,
      })
    : undefined

  const time = create(SessionTimeSchema, {
    created: BigInt(info.time.created),
    updated: BigInt(info.time.updated),
    ...(info.time.compacting !== undefined ? { compacting: BigInt(info.time.compacting) } : {}),
    ...(info.time.archived !== undefined ? { archived: BigInt(info.time.archived) } : {}),
  })

  const revert = info.revert
    ? create(SessionRevertSchema, {
        messageId: info.revert.messageID,
        ...(info.revert.partID ? { partId: info.revert.partID } : {}),
        ...(info.revert.snapshot ? { snapshot: info.revert.snapshot } : {}),
        ...(info.revert.diff ? { diff: info.revert.diff } : {}),
      })
    : undefined

  const project = info.project
    ? create(GlobalSessionProjectSchema, {
        id: info.project.id,
        worktree: info.project.worktree,
        ...(info.project.name ? { name: info.project.name } : {}),
      })
    : undefined

  return create(GlobalSessionSchema, {
    id: info.id,
    slug: info.slug,
    projectId: info.projectID,
    directory: info.directory,
    title: info.title,
    version: info.version,
    time,
    permission: toProtoPermissionRule(info.permission),
    ...(info.parentID ? { parentId: info.parentID } : {}),
    ...(summary ? { summary } : {}),
    ...(share ? { share } : {}),
    ...(revert ? { revert } : {}),
    ...(project ? { project } : {}),
  })
}

export const experimental = {
  async listToolIds(_req: ListToolIdsRequest) {
    const ids = await ToolRegistry.ids()
    return create(ListToolIdsResponseSchema, { ids })
  },

  async listTools(req: ListToolsRequest) {
    const tools = await ToolRegistry.tools({ providerID: req.provider, modelID: req.model })
    return create(ListToolsResponseSchema, {
      tools: tools.map((t) =>
        create(ToolSchema, {
          id: t.id,
          description: t.description,
          parameters: (t.parameters as any)?._def
            ? JSON.stringify(zodToJsonSchema(t.parameters as any))
            : JSON.stringify(t.parameters),
        }),
      ),
    })
  },

  async createWorktree(req: CreateWorktreeRequest) {
    const worktree = await Worktree.create({
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.startCommand !== undefined ? { startCommand: req.startCommand } : {}),
    })
    return create(CreateWorktreeResponseSchema, {
      worktree: create(WorktreeSchema, {
        name: worktree.name,
        branch: worktree.branch,
        directory: worktree.directory,
      }),
    })
  },

  async listWorktrees(_req: ListWorktreesRequest) {
    const sandboxes = await Project.sandboxes(Instance.project.id)
    return create(ListWorktreesResponseSchema, { directories: sandboxes })
  },

  async removeWorktree(req: RemoveWorktreeRequest) {
    await Worktree.remove({ directory: req.directory })
    await Project.removeSandbox(Instance.project.id, req.directory)
    return create(RemoveWorktreeResponseSchema, { success: true })
  },

  async resetWorktree(req: ResetWorktreeRequest) {
    await Worktree.reset({ directory: req.directory })
    return create(ResetWorktreeResponseSchema, { success: true })
  },

  async listGlobalSessions(req: ListGlobalSessionsRequest) {
    const limit = req.limit ?? 100
    const sessions: Session.GlobalInfo[] = []
    for await (const session of Session.listGlobal({
      directory: req.directory,
      roots: req.roots,
      start: req.start ? Number(req.start) : undefined,
      cursor: req.cursor ? Number(req.cursor) : undefined,
      search: req.search,
      limit: limit + 1,
      archived: req.archived,
    })) {
      sessions.push(session)
    }
    const hasMore = sessions.length > limit
    const list = hasMore ? sessions.slice(0, limit) : sessions
    const nextCursor = hasMore && list.length > 0 ? list[list.length - 1].time.updated : undefined

    return create(ListGlobalSessionsResponseSchema, {
      sessions: list.map(toProtoGlobalSession),
      ...(nextCursor !== undefined ? { nextCursor: BigInt(nextCursor) } : {}),
    })
  },

  async listMcpResources(_req: ListMcpResourcesRequest) {
    const resources = await MCP.resources()
    return create(ListMcpResourcesResponseSchema, {
      resources: Object.values(resources).map((r) =>
        create(McpResourceSchema, {
          name: r.name,
          uri: r.uri,
          client: r.client,
          ...(r.description ? { description: r.description } : {}),
          ...(r.mimeType ? { mimeType: r.mimeType } : {}),
        }),
      ),
    })
  },
}
