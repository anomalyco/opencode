import { RGBA, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { Locale } from "../../util/locale"
import { stringWidth } from "../../util/string-width"

export function PromptMetadataRow(props: {
  mode: "normal" | "shell"
  agent?: string
  auto: boolean
  model: string
  provider: string
  variant?: string
  /** What the workspace's limits leave for the model, once it is running low. */
  limit?: { readonly text: string; readonly danger: boolean }
  muted: boolean
  highlight: RGBA
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
}) {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  const layout = createMemo(() => {
    if (props.mode === "shell") return { agent: props.agent ?? "Shell", model: "" }
    return promptMetadataLayout({
      width: Math.max(0, dimensions().width - (dimensions().width < 44 ? 9 : 13)),
      terminalWidth: dimensions().width,
      agent: props.agent ?? "",
      auto: props.auto,
      model: props.model,
      provider: props.provider,
      variant: props.variant,
      limit: props.limit?.text,
    })
  })

  return (
    <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
      <Show
        when={(props.mode === "shell" || props.agent) && (layout().agent || layout().model)}
        fallback={<box height={1} />}
      >
        <Show when={layout().agent}>
          {(agent) => <text fg={fade(props.highlight, props.agentAlpha)}>{agent()}</text>}
        </Show>
        <Show when={props.mode === "normal" && layout().auto}>
          <text fg={fade(theme.text.muted, props.agentAlpha)}>auto</text>
        </Show>
        <Show when={props.mode === "normal" && layout().model}>
          <box flexDirection="row" gap={1} flexGrow={1} flexShrink={1} minWidth={0}>
            <Show when={layout().agent}>
              <text fg={fade(theme.text.muted, props.modelAlpha)}>·</text>
            </Show>
            <text
              flexShrink={1}
              minWidth={0}
              wrapMode="none"
              truncate
              fg={fade(props.muted ? theme.text.muted : theme.text.base, props.modelAlpha)}
            >
              {layout().model}
            </text>
            <Show when={layout().provider}>
              {(provider) => (
                <text flexShrink={0} fg={fade(theme.text.muted, props.modelAlpha)}>
                  {provider()}
                </text>
              )}
            </Show>
            <Show when={layout().variant}>
              {(variant) => (
                <>
                  <text fg={fade(theme.text.muted, props.variantAlpha)}>·</text>
                  <text
                    fg={fade(theme.text.feedback.warning.base, props.variantAlpha)}
                    attributes={TextAttributes.BOLD}
                  >
                    {variant()}
                  </text>
                </>
              )}
            </Show>
            <Show when={layout().limit ? props.limit : undefined}>
              {(limit) => (
                <text
                  flexShrink={0}
                  marginLeft={1}
                  wrapMode="none"
                  fg={fade(limit().danger ? theme.text.feedback.error.base : theme.text.muted, props.modelAlpha)}
                >
                  {limit().text}
                </text>
              )}
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

function fade(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

type Layout = {
  agent?: string
  auto?: boolean
  model: string
  provider?: string
  variant?: string
  limit?: string
}

function promptMetadataLayout(input: {
  width: number
  terminalWidth: number
  agent: string
  auto?: boolean
  model: string
  provider: string
  variant?: string
  limit?: string
}) {
  const agent = input.terminalWidth < 44 ? undefined : input.agent
  const provider = input.terminalWidth < 44 ? "" : input.provider
  const limit = input.limit
  const candidates: Layout[] = [
    { agent, auto: input.auto, model: input.model, provider, variant: input.variant, limit },
    { agent, model: input.model, provider, variant: input.variant, limit },
    {
      agent,
      model: input.model,
      provider: provider.split(" / ").at(-1) ?? provider,
      variant: input.variant,
      limit,
    },
    { agent, model: input.model, variant: input.variant, limit },
  ]
  const fit = candidates.find((candidate) => stringWidth(text(candidate)) <= input.width)
  if (fit) return fit

  const prefix = agent ? `${agent} · ` : ""
  const suffix = `${input.variant ? ` · ${input.variant}` : ""}${limit ? `  ${limit}` : ""}`
  return {
    agent,
    model: Locale.truncateWidth(
      input.model,
      Math.max(9, input.width - stringWidth(prefix) - stringWidth(suffix)),
    ).replace(/\s+…$/, "…"),
    variant: input.variant,
    limit,
  }
}

function text(input: Layout) {
  return [
    ...(input.agent ? [input.agent] : []),
    ...(input.auto ? ["auto"] : []),
    ...(input.model ? [...(input.agent ? ["·"] : []), input.model] : []),
    ...(input.provider ? [input.provider] : []),
    ...(input.variant ? ["·", input.variant] : []),
    ...(input.limit ? [` ${input.limit}`] : []),
  ].join(" ")
}
