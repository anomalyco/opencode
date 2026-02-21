import { create } from "@bufbuild/protobuf"
import type { Session } from "../../session"
import {
  SessionSchema,
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

export function toProtoSession(info: Session.Info) {
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

  return create(SessionSchema, {
    id: info.id,
    slug: info.slug,
    projectId: info.projectID,
    directory: info.directory,
    title: info.title,
    version: info.version,
    time,
    ...(info.parentID ? { parentId: info.parentID } : {}),
    ...(summary ? { summary } : {}),
    ...(share ? { share } : {}),
    permission: toProtoPermissionRule(info.permission),
    ...(revert ? { revert } : {}),
  })
}
