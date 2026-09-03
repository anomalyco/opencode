import { type Component, createMemo, Match, Switch } from "solid-js"
import { TextShimmer } from "@opencode-ai/ui/text-shimmer"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import type { ToolProps } from "./message-part"
import { useVisualization } from "../context/visualization"
import { VisualizationFrame } from "./visualization-frame"
import { decodeVisualizationResult, type VisualizationResult } from "./visualization-schema"

export type VisualizationToolState =
  | { type: "thinking" }
  | { type: "frame"; value: VisualizationResult }
  | { type: "invalid" }
  | { type: "empty" }

export function visualizationStructured(structured: unknown, metadata: unknown) {
  return structured === undefined ? metadata : structured
}

export function visualizationToolState(
  status: string | undefined,
  structured?: unknown,
  enabled = false,
): VisualizationToolState {
  if (status === "pending" || status === "running") return { type: "thinking" }
  if (status !== "completed") return { type: "empty" }
  if (!enabled) return { type: "invalid" }
  const value = decodeVisualizationResult(structured)
  if (!value) return { type: "invalid" }
  return { type: "frame", value }
}

export const VisualizationTool: Component<ToolProps> = (props) => {
  const i18n = useI18n()
  const visualization = useVisualization()
  const state = createMemo(() =>
    visualizationToolState(
      props.status,
      visualizationStructured(props.structured, props.metadata),
      visualization.enabled,
    ),
  )
  const value = createMemo(() => {
    const current = state()
    if (current.type === "frame") return current.value
  })

  return (
    <Switch>
      <Match when={state().type === "thinking"}>
        <div data-component="visualization-tool" data-state="thinking">
          <TextShimmer text={i18n.t("ui.sessionTurn.status.thinking")} active />
        </div>
      </Match>
      <Match when={value()}>
        {(value) => (
          <div data-component="visualization-tool" data-state="frame">
            <VisualizationFrame
              value={value()}
              sessionID={props.sessionID}
              onContentRendered={props.onContentRendered}
            />
          </div>
        )}
      </Match>
      <Match when={state().type === "invalid"}>
        <div data-component="visualization-tool" data-state="invalid">
          <span>{i18n.t("ui.toolErrorCard.failed")}</span>
        </div>
      </Match>
    </Switch>
  )
}
