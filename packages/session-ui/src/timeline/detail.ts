import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client/promise"
import { shellResultFailed } from "../message/current-tool-state"

export const timelineCategories = ["shell", "edit", "thinking", "subagents", "notices", "tools", "commentary"] as const

export type TimelineCategory = (typeof timelineCategories)[number]

export type TimelinePlacement = "separate" | "grouped" | "hidden"

export type TimelineExpansion = "collapsed" | "expanded"

export type TimelineDetail = {
  shell: { placement: TimelinePlacement; details: TimelineExpansion }
  edit: { placement: TimelinePlacement; details: TimelineExpansion }
  thinking: { placement: TimelinePlacement; details: TimelineExpansion }
  subagents: { placement: TimelinePlacement }
  notices: { placement: TimelinePlacement }
  tools: { placement: TimelinePlacement }
  commentary: { placement: TimelinePlacement }
}

export const timelinePresets = [
  {
    id: "everything",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "separate", details: "expanded" },
      subagents: { placement: "separate" },
      notices: { placement: "separate" },
      tools: { placement: "separate" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "detailed",
    value: {
      shell: { placement: "separate", details: "expanded" },
      edit: { placement: "separate", details: "expanded" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "compact",
    value: {
      shell: { placement: "grouped", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "quiet",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "separate" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
      commentary: { placement: "separate" },
    },
  },
  {
    id: "text-only",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "hidden", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "hidden" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
      commentary: { placement: "separate" },
    },
  },
] as const satisfies readonly { id: string; value: TimelineDetail }[]

export function timelinePreset(value: TimelineDetail) {
  return timelinePresets.find((preset) =>
    timelineCategories.every((category) => {
      const current = value[category]
      const expected = preset.value[category]

      return (
        current.placement === expected.placement &&
        (current.placement === "hidden" ||
          !("details" in current) ||
          ("details" in expected && current.details === expected.details))
      )
    }),
  )
}

export function timelineCategory(
  content: SessionMessageAssistant["content"][number],
): keyof TimelineDetail | undefined {
  if (content.type === "text") return

  if (content.type === "reasoning") return "thinking"

  if (["shell", "execute", "bash"].includes(content.name)) return "shell"

  if (["edit", "write", "patch", "apply_patch"].includes(content.name)) return "edit"

  if (["subagent", "task"].includes(content.name)) return "subagents"

  return "tools"
}

// Like the TUI, background work reports its outcome as its own row where it finished, never folded into a group.
// A subagent's outcome follows the subagent setting, so it shows wherever its launch does.
export function timelineNoticePlacement(message: SessionMessageInfo, detail: TimelineDetail): TimelinePlacement {
  const source = message.type === "synthetic" ? message.metadata?.source : undefined
  const placement = source === "subagent" ? detail.subagents.placement : detail.notices.placement

  if (placement === "hidden") return timelineNoticeRequired(message) ? "separate" : "hidden"

  return source === "subagent" || source === "shell" ? "separate" : placement
}

export function timelineNoticeRequired(message: SessionMessageInfo) {
  if (message.type === "compaction") return message.status !== "completed"

  if (message.type !== "synthetic") return false
  const metadata = message.metadata

  return (
    metadata?.state === "error" ||
    (metadata?.source === "shell" && metadata.state === "completed" && shellResultFailed(metadata))
  )
}
