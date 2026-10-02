import type { SessionUpdate } from "@agentclientprotocol/sdk"

export const UpdateMethod = "opencode/session/child_update"

export type Session = {
  readonly id: string
  readonly parentID: string
  readonly depth: number
  readonly title?: string
}

export type Event =
  | { readonly type: "update"; readonly update: SessionUpdate }
  | {
      readonly type: "status"
      readonly status: "created" | "running" | "completed" | "failed" | "interrupted"
      readonly error?: { readonly type: string; readonly message: string }
    }

export type Update = {
  readonly rootSessionId: string
  readonly childSessionId: string
  readonly parentSessionId: string
  readonly depth: number
  readonly title?: string
} & Event

export function update(rootSessionID: string, child: Session, event: Event): Update {
  return {
    rootSessionId: rootSessionID,
    childSessionId: child.id,
    parentSessionId: child.parentID,
    depth: child.depth,
    ...(child.title ? { title: child.title } : {}),
    ...event,
  }
}

export function project(update: SessionUpdate, child: Session) {
  const projected = { ...update }
  projected._meta = { ...projected._meta, ...meta(child) }
  if (projected.sessionUpdate === "tool_call" || projected.sessionUpdate === "tool_call_update") {
    projected.toolCallId = toolCallID(child, projected.toolCallId)
    if (projected.title) projected.title = title(child, projected.title)
  }
  return projected
}

export function meta(child: Session) {
  return {
    "opencode/child-session": {
      id: child.id,
      parentID: child.parentID,
      depth: child.depth,
      ...(child.title ? { title: child.title } : {}),
    },
  }
}

export function toolCallID(child: Session | undefined, id: string) {
  return child ? `${child.id}:${id}` : id
}

export function title(child: Session | undefined, value: string) {
  return child?.title ? `${child.title}: ${value}` : value
}

export * as ACPChild from "./child"
