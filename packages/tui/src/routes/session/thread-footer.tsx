import { createMemo, createSignal, Show } from "solid-js"
import { useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme } from "../../context/theme"
import { SplitBorder } from "../../ui/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk/v2"
import { Locale } from "../../util/locale"
import { useTerminalDimensions } from "@opentui/solid"
import { useCommandShortcut, useOpencodeKeymap } from "../../keymap"
import { getSelectedText, getParentTitle, getThreadChildren } from "../../util/session"

export function ThreadFooter() {
  const route = useRouteData("session")
  const sync = useSync()
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const session = createMemo(() => sync.session.get(route.sessionID))

  const threadInfo = createMemo(() => {
    const s = session()
    if (!s) return { selectedText: undefined, parentTitle: undefined, agent: undefined }
    return {
      selectedText: getSelectedText(s),
      parentTitle: getParentTitle(s),
      agent: s.agent,
    }
  })

  const siblings = createMemo(() => {
    const s = session()
    if (!s?.parentID) return { prev: null, next: null, total: 0, index: 0 }
    const children = getThreadChildren(s.parentID, sync.data.session)
    const index = children.findIndex((c) => c.id === s.id)
    return {
      prev: index < children.length - 1 ? children[index + 1] : null,
      next: index > 0 ? children[index - 1] : null,
      total: children.length,
      index: index + 1,
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
  const keymap = useOpencodeKeymap()
  const parentShortcut = useCommandShortcut("session.parent")
  const prevShortcut = useCommandShortcut("session.child.previous")
  const nextShortcut = useCommandShortcut("session.child.next")
  const graphShortcut = useCommandShortcut("session.graph")
  const [hover, setHover] = createSignal<"parent" | "prev" | "next" | "graph" | null>(null)
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
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>
              <b>Thread</b>
            </text>
            <Show when={threadInfo().parentTitle}>
              <text style={{ fg: theme.textMuted }}> · Child of {threadInfo().parentTitle}</text>
            </Show>
            <Show when={siblings().total > 0}>
              <text style={{ fg: theme.textMuted }}>
                {" "}({siblings().index} of {siblings().total})
              </text>
            </Show>
            <Show when={usage()}>
              {(item) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {" "}{[item().context, item().cost].filter(Boolean).join(" · ")}
                </text>
              )}
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <box
              onMouseOver={() => setHover("graph")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.graph")}
              backgroundColor={hover() === "graph" ? theme.backgroundElement : theme.backgroundPanel}
            >
              <text fg={theme.text}>
                Graph <span style={{ fg: theme.textMuted }}>{graphShortcut()}</span>
              </text>
            </box>
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
              opacity={siblings().prev ? 1.0 : 0.5}
            >
              <text fg={siblings().prev ? theme.text : theme.textMuted}>
                Prev <span style={{ fg: theme.textMuted }}>{prevShortcut()}</span>
              </text>
            </box>
            <box
              onMouseOver={() => setHover("next")}
              onMouseOut={() => setHover(null)}
              onMouseUp={() => keymap.dispatchCommand("session.child.next")}
              backgroundColor={hover() === "next" ? theme.backgroundElement : theme.backgroundPanel}
              opacity={siblings().next ? 1.0 : 0.5}
            >
              <text fg={siblings().next ? theme.text : theme.textMuted}>
                Next <span style={{ fg: theme.textMuted }}>{nextShortcut()}</span>
              </text>
            </box>
          </box>
        </box>
        <Show when={threadInfo().selectedText}>
          <box
            marginTop={1}
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            border={["left"]}
            borderColor={theme.primary}
          >
            <text fg={theme.textMuted} wrapMode="word">
              "{threadInfo().selectedText}"
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
