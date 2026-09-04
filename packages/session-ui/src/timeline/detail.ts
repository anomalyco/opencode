import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client/promise"
import { shellResultFailed } from "../message/current-tool-state"

export const timelineCategories = ["shell", "edit", "thinking", "subagents", "notices", "tools"] as const
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
    },
  },
  {
    id: "compact",
    value: {
      shell: { placement: "grouped", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "grouped", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "grouped" },
      tools: { placement: "grouped" },
    },
  },
  {
    id: "quiet",
    value: {
      shell: { placement: "hidden", details: "collapsed" },
      edit: { placement: "grouped", details: "collapsed" },
      thinking: { placement: "hidden", details: "collapsed" },
      subagents: { placement: "grouped" },
      notices: { placement: "hidden" },
      tools: { placement: "hidden" },
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

export function timelineNoticeRequired(message: SessionMessageInfo) {
  if (message.type === "compaction") return message.status !== "completed"
  if (message.type !== "synthetic") return false
  const metadata = message.metadata
  return (
    metadata?.state === "error" ||
    (metadata?.source === "shell" && metadata.state === "completed" && shellResultFailed(metadata))
  )
}
