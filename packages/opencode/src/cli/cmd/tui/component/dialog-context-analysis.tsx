import { useDialog } from "@tui/ui/dialog"
import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"

type AnalysisData = {
  actionable_entities: Array<{
    type: string
    value: string
    description: string
    priority: "high" | "medium" | "low"
    confidence: number
  }>
  tasks: Array<{
    description: string
    type: string
    priority: "high" | "medium" | "low"
    dependencies?: string[]
    estimated_effort: string
    confidence: number
  }>
  relevance: {
    is_outdated: boolean
    relevance_score: number
    reasons: string[]
    suggested_action: string
  }
  traffic_light_prediction: {
    priority: "high" | "medium" | "low"
    urgency: "immediate" | "soon" | "later"
    confidence: number
    reasoning: string
  }
}

export function DialogContextAnalysis(props: { contextName: string; analysis: AnalysisData }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const getPriorityColor = (priority: "high" | "medium" | "low") => {
    switch (priority) {
      case "high":
        return theme.error
      case "medium":
        return theme.warning
      case "low":
        return theme.success
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return theme.success
    if (confidence >= 0.6) return theme.warning
    return theme.error
  }

  return (
    <box flexDirection="column" gap={1} width={60}>
      <text attributes={TextAttributes.BOLD} fg={theme.accent}>
        Context Analysis: {props.contextName}
      </text>

      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Traffic Light Prediction
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={getPriorityColor(props.analysis.traffic_light_prediction.priority)}>
            Priority: {props.analysis.traffic_light_prediction.priority.toUpperCase()}
          </text>
          <text fg={theme.textMuted}>Urgency: {props.analysis.traffic_light_prediction.urgency}</text>
          <text fg={getConfidenceColor(props.analysis.traffic_light_prediction.confidence)}>
            ({Math.round(props.analysis.traffic_light_prediction.confidence * 100)}%)
          </text>
        </box>
        <text fg={theme.textMuted} wrapMode="word">
          {props.analysis.traffic_light_prediction.reasoning}
        </text>
      </box>

      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Actionable Entities ({props.analysis.actionable_entities.length})
        </text>
        <Show when={props.analysis.actionable_entities.length > 0}>
          <For each={props.analysis.actionable_entities.slice(0, 5)}>
            {(entity) => (
              <box flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text fg={getPriorityColor(entity.priority)}>[{entity.type.toUpperCase()}]</text>
                  <text fg={theme.text}>{entity.value}</text>
                  <text fg={getConfidenceColor(entity.confidence)}>{Math.round(entity.confidence * 100)}%</text>
                </box>
                <text fg={theme.textMuted} marginLeft={2} wrapMode="word">
                  {entity.description}
                </text>
              </box>
            )}
          </For>
          <Show when={props.analysis.actionable_entities.length > 5}>
            <text fg={theme.textMuted}>... and {props.analysis.actionable_entities.length - 5} more</text>
          </Show>
        </Show>
        <Show when={props.analysis.actionable_entities.length === 0}>
          <text fg={theme.textMuted}>No actionable entities found</text>
        </Show>
      </box>

      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Suggested Tasks ({props.analysis.tasks.length})
        </text>
        <Show when={props.analysis.tasks.length > 0}>
          <For each={props.analysis.tasks.slice(0, 3)}>
            {(task) => (
              <box flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text fg={getPriorityColor(task.priority)}>[{task.type.toUpperCase()}]</text>
                  <text fg={theme.textMuted}>{task.estimated_effort}</text>
                  <text fg={getConfidenceColor(task.confidence)}>{Math.round(task.confidence * 100)}%</text>
                </box>
                <text fg={theme.text} marginLeft={2} wrapMode="word">
                  {task.description}
                </text>
                <Show when={task.dependencies && task.dependencies.length > 0}>
                  <text fg={theme.textMuted} marginLeft={2}>
                    Depends on: {task.dependencies!.join(", ")}
                  </text>
                </Show>
              </box>
            )}
          </For>
          <Show when={props.analysis.tasks.length > 3}>
            <text fg={theme.textMuted}>... and {props.analysis.tasks.length - 3} more tasks</text>
          </Show>
        </Show>
        <Show when={props.analysis.tasks.length === 0}>
          <text fg={theme.textMuted}>No tasks identified</text>
        </Show>
      </box>

      <box flexDirection="column" gap={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Relevance Analysis
        </text>
        <box flexDirection="row" gap={2}>
          <text fg={props.analysis.relevance.is_outdated ? theme.error : theme.success}>
            {props.analysis.relevance.is_outdated ? "OUTDATED" : "CURRENT"}
          </text>
          <text fg={theme.textMuted}>Score: {Math.round(props.analysis.relevance.relevance_score * 100)}%</text>
          <text fg={theme.accent}>Action: {props.analysis.relevance.suggested_action.toUpperCase()}</text>
        </box>
        <Show when={props.analysis.relevance.reasons.length > 0}>
          <text fg={theme.textMuted} wrapMode="word">
            {props.analysis.relevance.reasons.join("; ")}
          </text>
        </Show>
      </box>

      <box flexDirection="row" gap={2} marginTop={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} onMouseUp={() => dialog.clear()}>
          Close
        </text>
      </box>
    </box>
  )
}
