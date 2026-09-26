import { createMemo, createSignal, Show } from "solid-js"
import { useLocal } from "../../context/local"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import type { Agent, AssistantMessage, Provider, Session } from "@opencode-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"

type AgentVariantConfig = Pick<Agent, "model" | "variant" | "options">
type ProviderModelVariants = Pick<Provider["models"][string], "variants">

export function resolveSubagentVariant(
  sessionModel: Session["model"],
  agent: AgentVariantConfig | undefined,
  model: ProviderModelVariants | undefined,
) {
  const persisted = sessionModel?.variant
  if (persisted && persisted !== "default") return persisted
  if (!sessionModel || !agent?.model || !model?.variants) return undefined
  if (agent.model.providerID !== sessionModel.providerID || agent.model.modelID !== sessionModel.id) return undefined
  if (agent.variant && agent.variant in model.variants) return agent.variant
  const effort = agent.options.reasoningEffort
  if (typeof effort === "string" && effort in model.variants) return effort
  return undefined
}

export function SubagentFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const local = useLocal()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(route.sessionID))

  const subagentInfo = createMemo(() => {
    const s = session()
    if (!s) return { label: "Subagent", index: 0, total: 0 }
    const agentMatch = s.title.match(/@(\w+) subagent/)
    const label = agentMatch ? Locale.titlecase(agentMatch[1]) : "Subagent"

    if (!s.parentID) return { label, index: 0, total: 0 }

    const siblings = sync.data.session
      .filter((x) => x.parentID === s.parentID)
      .toSorted((a, b) => a.time.created - b.time.created)
    const index = siblings.findIndex((x) => x.id === s.id)

    return { label, index: index + 1, total: siblings.length }
  })

  const modelInfo = createMemo(() => {
    const current = session()
    if (!current?.model) return undefined
    const sessionModel = current.model
    const provider = sync.data.provider.find((item) => item.id === sessionModel.providerID)
    const model = provider?.models[sessionModel.id]
    const agent = sync.data.agent.find((item) => item.name === current.agent)
    return {
      model: model?.name ?? sessionModel.id,
      provider: provider?.name ?? sessionModel.providerID,
      variant: resolveSubagentVariant(sessionModel, agent, model),
    }
  })

  const usage = createMemo(() => {
    const msg = messages()
    const last = msg.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) return

    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens <= 0) return

    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const pct = model?.limit.context ? `${Math.round((tokens / model.limit.context) * 100)}%` : undefined
    const cost = session()?.cost ?? 0

    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    })

    return {
      context: pct ? `${Locale.number(tokens)} (${pct})` : Locale.number(tokens),
      cost: cost > 0 ? money.format(cost) : undefined,
    }
  })

  const { theme } = useTheme()
  const agentColor = createMemo(() => {
    const agent = session()?.agent
    return agent ? local.agent.color(agent) : theme.text
  })
  const keymap = useOpencodeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const previousShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | null>(null)
  useTerminalDimensions()

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="column" gap={0}>
          <Show when={modelInfo()}>
            {(item) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.text} wrapMode="none">
                  {item().model}
                </text>
                <text fg={theme.textMuted} wrapMode="none">
                  {item().provider}
                </text>
                <Show when={item().variant}>
                  {(variant) => (
                    <>
                      <text fg={theme.textMuted} wrapMode="none">
                        ·
                      </text>
                      <text fg={theme.warning} wrapMode="none">
                        <b>{variant()}</b>
                      </text>
                    </>
                  )}
                </Show>
              </box>
            )}
          </Show>
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <box flexDirection="row" gap={1}>
              <text fg={agentColor()}>
                <b>{subagentInfo().label}</b>
              </text>
              <Show when={subagentInfo().total > 0}>
                <text style={{ fg: theme.textMuted }}>
                  ({subagentInfo().index} of {subagentInfo().total})
                </text>
              </Show>
              <Show when={usage()}>
                {(item) => (
                  <text fg={theme.textMuted} wrapMode="none">
                    {[item().context, item().cost].filter(Boolean).join(" · ")}
                  </text>
                )}
              </Show>
            </box>
            <box flexDirection="row" gap={2}>
              <box
                onMouseOver={() => setHover("parent")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.parent")}
                backgroundColor={hover() === "parent" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Parent <span style={{ fg: theme.textMuted }}>{parentShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("prev")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.child.previous")}
                backgroundColor={hover() === "prev" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Prev <span style={{ fg: theme.textMuted }}>{previousShortcut()}</span>
                </text>
              </box>
              <box
                onMouseOver={() => setHover("next")}
                onMouseOut={() => setHover(null)}
                onMouseUp={() => keymap.dispatchCommand("session.child.next")}
                backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
              >
                <text fg={theme.text}>
                  Next <span style={{ fg: theme.textMuted }}>{nextShortcut()}</span>
                </text>
              </box>
            </box>
          </box>
        </box>
      </box>
    </box>
  )
}
