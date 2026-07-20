// Pure state machine for the permission UI.
//
// Lives outside the JSX component so it can be tested independently. The
// machine has three stages:
//
//   permission → initial view with Allow once / Always / Reject options
//   always     → confirmation step (Confirm / Cancel)
//   reject     → text input for rejection message
//
// permissionRun() is the main transition: given the current state and the
// selected option, it returns a new state and optionally a PermissionReply
// to send to the SDK. The component calls this on enter/click.
//
// permissionInfo() extracts display info (icon, title, lines, diff) from
// the request, delegating to tool.ts for tool-specific formatting.
import type { MiniPermissionRequest, PermissionReply } from "./types"
import { toolPath, toolPermissionInfo } from "./tool"

type Dict = Record<string, unknown>

export type PermissionStage = "permission" | "always" | "reject"
export type PermissionOption = "once" | "always" | "reject" | "confirm" | "cancel"

export type PermissionBodyState = {
  requestID: string
  sessionID: string
  stage: PermissionStage
  selected: PermissionOption
  message: string
  submitting: boolean
}

export type PermissionInfo = {
  icon: string
  title: string
  lines: string[]
  diff?: string
  patch?: string
  file?: string
}

export type PermissionStep = {
  state: PermissionBodyState
  reply?: PermissionReply
}

function dict(v: unknown): Dict {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {}
  }

  return { ...v }
}

function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function data(request: MiniPermissionRequest): { input: Dict; metadata: Dict } {
  const state = request.tool?.state
  const metadata = {
    ...(state && state.status !== "streaming" ? dict(state.structured) : {}),
    ...dict(request.metadata),
  }
  if (!state || state.status === "streaming") return { input: {}, metadata }
  return { input: dict(state.input), metadata }
}

function patterns(request: MiniPermissionRequest): string[] {
  return request.resources.filter((item): item is string => typeof item === "string")
}

export function createPermissionBodyState(
  request: Pick<MiniPermissionRequest, "id" | "sessionID">,
): PermissionBodyState {
  return {
    requestID: request.id,
    sessionID: request.sessionID,
    stage: "permission",
    selected: "once",
    message: "",
    submitting: false,
  }
}

export function permissionOptions(stage: PermissionStage): PermissionOption[] {
  if (stage === "permission") {
    return ["once", "always", "reject"]
  }

  if (stage === "always") {
    return ["confirm", "cancel"]
  }

  return []
}

export function permissionInfo(request: MiniPermissionRequest, directory?: string): PermissionInfo {
  const pats = patterns(request)
  const source = data(request)
  const info = toolPermissionInfo(request.action, source.input, source.metadata, pats, directory)
  if (info) {
    return info
  }

  if (request.action === "external_directory") {
    const meta = dict(request.metadata)
    const raw = text(meta.parentDir) || text(meta.filepath) || pats[0] || ""
    const dir = raw.includes("*") ? raw.slice(0, raw.indexOf("*")).replace(/[\\/]+$/, "") : raw
    return {
      icon: "←",
      title: `Access external directory ${toolPath(dir, { home: true, directory })}`,
      lines: pats.map((item) => `- ${item}`),
    }
  }

  if (request.action === "doom_loop") {
    return {
      icon: "⟳",
      title: "Continue after repeated failures",
      lines: ["This keeps the session running despite repeated failures."],
    }
  }

  return {
    icon: "⚙",
    title: `Call tool ${request.action}`,
    lines: [`Tool: ${request.action}`],
  }
}

export function permissionAlwaysLines(request: MiniPermissionRequest): string[] {
  const save = request.save ?? []
  if (save.length === 1 && save[0] === "*") {
    return [`This will allow ${request.action} until OpenCode is restarted.`]
  }

  return ["This will allow the following patterns until OpenCode is restarted.", ...save.map((item) => `- ${item}`)]
}

export function permissionLabel(option: PermissionOption): string {
  if (option === "once") return "Allow once"
  if (option === "always") return "Allow always"
  if (option === "reject") return "Reject"
  if (option === "confirm") return "Confirm"
  return "Cancel"
}

export function permissionReply(
  sessionID: string,
  requestID: string,
  reply: PermissionReply["reply"],
  message?: string,
): PermissionReply {
  return {
    sessionID,
    requestID,
    reply,
    ...(message && message.trim() ? { message: message.trim() } : {}),
  }
}

export function permissionShift(
  state: PermissionBodyState,
  dir: -1 | 1,
  list = permissionOptions(state.stage),
): PermissionBodyState {
  if (list.length === 0) {
    return state
  }

  const idx = Math.max(0, list.indexOf(state.selected))
  const selected = list[(idx + dir + list.length) % list.length]
  return {
    ...state,
    selected,
  }
}

export function permissionHover(state: PermissionBodyState, option: PermissionOption): PermissionBodyState {
  return {
    ...state,
    selected: option,
  }
}

export function permissionRun(state: PermissionBodyState, requestID: string, option: PermissionOption): PermissionStep {
  if (state.submitting) {
    return { state }
  }

  if (state.stage === "permission") {
    if (option === "always") {
      return {
        state: {
          ...state,
          stage: "always",
          selected: "confirm",
        },
      }
    }

    if (option === "reject") {
      return {
        state: {
          ...state,
          stage: "reject",
          selected: "reject",
        },
      }
    }

    return {
      state,
      reply: permissionReply(state.sessionID, requestID, "once"),
    }
  }

  if (state.stage !== "always") {
    return { state }
  }

  if (option === "cancel") {
    return {
      state: {
        ...state,
        stage: "permission",
        selected: "always",
      },
    }
  }

  return {
    state,
    reply: permissionReply(state.sessionID, requestID, "always"),
  }
}

export function permissionReject(state: PermissionBodyState, requestID: string): PermissionReply | undefined {
  if (state.submitting) {
    return undefined
  }

  return permissionReply(state.sessionID, requestID, "reject", state.message)
}

export function permissionCancel(state: PermissionBodyState): PermissionBodyState {
  return {
    ...state,
    stage: "permission",
    selected: "reject",
  }
}

export function permissionEscape(state: PermissionBodyState): PermissionBodyState {
  if (state.stage === "always") {
    return {
      ...state,
      stage: "permission",
      selected: "always",
    }
  }

  return {
    ...state,
    stage: "reject",
    selected: "reject",
  }
}
