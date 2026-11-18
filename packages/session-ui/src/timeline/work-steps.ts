export const workStepViews = ["compact", "standard", "detailed", "verbose"] as const

export type WorkStepView = (typeof workStepViews)[number]

export const workStepCollapseTimings = ["completion", "next-input"] as const

export type WorkStepCollapseTiming = (typeof workStepCollapseTimings)[number]

export const workStepFoldedReplies = ["all", "final"] as const

export type WorkStepFoldedReplies = (typeof workStepFoldedReplies)[number]

export type WorkSteps = Readonly<{
  view: WorkStepView
  collapseTiming: WorkStepCollapseTiming
  foldedReplies: WorkStepFoldedReplies
}>

export const defaultWorkSteps: WorkSteps = Object.freeze({
  view: "standard",
  collapseTiming: "completion",
  foldedReplies: "all",
})

export type WorkStepPolicy = Readonly<{
  view: WorkStepView
  collapseTiming: WorkStepCollapseTiming
  foldedReplies: WorkStepFoldedReplies
  foldCompletedTurns: boolean
  groupActivity: "always" | "completed" | "never"
  liveProcessDetail: boolean
  settledReasoningPreview: boolean
}>

export function workStepPolicy(settings: WorkSteps = defaultWorkSteps): WorkStepPolicy {
  return {
    view: settings.view,
    collapseTiming: settings.collapseTiming,
    foldedReplies: settings.foldedReplies,
    foldCompletedTurns: settings.view !== "verbose",
    liveProcessDetail: settings.view === "standard" || settings.view === "detailed",
    settledReasoningPreview: settings.view !== "compact",
    groupActivity:
      settings.view === "compact" || settings.view === "standard"
        ? "always"
        : settings.view === "detailed"
          ? "completed"
          : "never",
  }
}

export type WorkStepTurnStatus = "live" | "completed" | "error" | "interrupted"

export type WorkStepTurn = Readonly<{
  sessionID: string
  turnID: string
  status: WorkStepTurnStatus
  latestCompletedTurn: boolean
  hasLaterInput: boolean
}>

export type WorkStepPhase = Readonly<{
  sessionID: string
  turnID: string
  phaseID: string
  status: "live" | "completed"
}>

export type WorkStepReply = Readonly<{
  kind: "final" | "intermediate"
  status: "live" | "completed"
}>

export type WorkStepDisclosureMap = Readonly<Record<string, boolean | undefined>>

export const emptyWorkStepDisclosure: WorkStepDisclosureMap = Object.freeze({})

export function workTurnDisclosureKey(sessionID: string, turnID: string) {
  return JSON.stringify(["work-turn", sessionID, turnID])
}

export function workPhaseDisclosureKey(sessionID: string, turnID: string, phaseID: string) {
  return JSON.stringify(["work-phase", sessionID, turnID, phaseID])
}

export function workTurnOpen(
  policy: WorkStepPolicy,
  turn: WorkStepTurn,
  disclosure: WorkStepDisclosureMap = emptyWorkStepDisclosure,
) {
  if (turn.status === "live") return true

  const manual = disclosure[workTurnDisclosureKey(turn.sessionID, turn.turnID)]

  if (turn.status === "error" || turn.status === "interrupted") return manual ?? true

  if (!policy.foldCompletedTurns) return true

  return manual ?? (policy.collapseTiming === "next-input" && turn.latestCompletedTurn && !turn.hasLaterInput)
}

export function workPhaseOpen(
  policy: WorkStepPolicy,
  phase: WorkStepPhase,
  disclosure: WorkStepDisclosureMap = emptyWorkStepDisclosure,
) {
  const manual = disclosure[workPhaseDisclosureKey(phase.sessionID, phase.turnID, phase.phaseID)]

  if (manual !== undefined) return manual

  if (policy.view === "verbose") return true

  if (policy.view === "detailed") return phase.status === "live"

  return false
}

export function workReplyVisible(policy: WorkStepPolicy, reply: WorkStepReply, turnOpen: boolean) {
  if (policy.foldedReplies === "all" || reply.kind === "final" || reply.status === "live") return true

  return turnOpen
}

export function setWorkTurnOpen(
  disclosure: WorkStepDisclosureMap,
  turn: Pick<WorkStepTurn, "sessionID" | "turnID">,
  open: boolean,
) {
  return {
    ...disclosure,
    [workTurnDisclosureKey(turn.sessionID, turn.turnID)]: open,
  }
}

export function setWorkPhaseOpen(
  disclosure: WorkStepDisclosureMap,
  phase: Pick<WorkStepPhase, "sessionID" | "turnID" | "phaseID">,
  open: boolean,
) {
  return {
    ...disclosure,
    [workPhaseDisclosureKey(phase.sessionID, phase.turnID, phase.phaseID)]: open,
  }
}
