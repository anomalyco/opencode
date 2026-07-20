import type { MiniPermissionRequest, PermissionReply } from "./types"
import { permissionAlwaysLines, permissionOptionLabel, permissionPresentation } from "../util/permission"
import { toolPath } from "./tool"

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

export type PermissionStep = {
  state: PermissionBodyState
  reply?: PermissionReply
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

export function permissionInfo(request: MiniPermissionRequest, directory?: string) {
  const state = request.tool?.state
  return permissionPresentation(
    {
      action: request.action,
      resources: request.resources,
      metadata: request.metadata,
      input: state?.status === "streaming" ? undefined : state?.input,
      structured: state?.status === "streaming" ? undefined : state?.structured,
    },
    (value) => toolPath(value, { home: true, directory }),
  )
}

export function permissionLabel(option: PermissionOption): string {
  return permissionOptionLabel(option)
}

export { permissionAlwaysLines }

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
