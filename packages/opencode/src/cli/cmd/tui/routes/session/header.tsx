import { type Accessor, createMemo, Match, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import type { AssistantMessage, Session } from "@opencode-ai/sdk"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useRenderer } from "@opentui/solid"
import { DialogKanban } from "../../component/dialog-kanban"
import { useServerStatus } from "../../context/server-status"
import { useSDK } from "@tui/context/sdk"

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text}>
      <span style={{ bold: true, fg: theme.accent }}>#</span>{" "}
      <span style={{ bold: true }}>{props.session().title}</span>
    </text>
  )
}

const ContextInfo = (props: { context: Accessor<string | undefined>; cost: Accessor<string> }) => {
  const { theme } = useTheme()
  return (
    <Show when={props.context()}>
      <text fg={theme.textMuted} wrapMode="none" flexShrink={0}>
        {props.context()} ({props.cost()})
      </text>
    </Show>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const sdk = useSDK()
  const dialog = useDialog()
  const renderer = useRenderer()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const serverStatus = useServerStatus()

  const port = serverStatus.port()

  const showServerDialog = () => {
    const options: DialogSelectOption<string>[] = [
      {
        title: "Restart Server",
        value: "restart",
        description: "Restart the OpenCode server",
        onSelect: async (ctx) => {
          ctx.clear()
          try {
            await fetch(`${sdk.url}/server/restart`, { method: "POST" })
          } catch (error) {
            console.error("Failed to restart server:", error)
          }
        },
      },
      {
        title: "Copy Server URL",
        value: "copy",
        description: `Copy ${serverStatus.url()} to clipboard`,
        onSelect: (ctx) => {
          serverStatus.copyUrl()
          ctx.clear()
        },
      },
    ]

    dialog.replace(() => <DialogSelect title="Server Management" options={options} />)
  }
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")

  const openKanban = () => {
    dialog.replace(() => <DialogKanban />)
  }

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    let result = total.toLocaleString()
    if (model?.limit.context) {
      result += "/" + Math.round((total / model.limit.context) * 100) + "%"
    }
    return result
  })

  const { theme } = useTheme()

  return (
    <box paddingLeft={1} paddingRight={1} {...SplitBorder} borderColor={theme.backgroundElement} flexShrink={0}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
        <box flexDirection="row" gap={2} alignItems="center">
          <text fg={theme.text}>
            <span style={{ bold: true, fg: theme.accent }}>#</span>{" "}
            <span style={{ bold: true }}>{session().title}</span>
          </text>
          <text
            fg={theme.textMuted}
            onMouseUp={() => {
              if (renderer.getSelection()?.getSelectedText()) return
              showServerDialog()
            }}
          >
            server:{port}
          </text>
        </box>
        <text
          fg={theme.textMuted}
          wrapMode="none"
          onMouseUp={() => {
            if (renderer.getSelection()?.getSelectedText()) return
            openKanban()
          }}
        >
          ▦ Kanban
        </text>
      </box>
      <Show
        when={shareEnabled()}
        fallback={
          <box flexDirection="row" justifyContent="space-between" gap={1}>
            <text fg={theme.textMuted} wrapMode="word">
              Sharing is disabled for this workspace
            </text>
            <ContextInfo context={context} cost={cost} />
          </box>
        }
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexGrow={1} flexShrink={1}>
            <Switch>
              <Match when={session().share?.url}>
                <text fg={theme.textMuted} wrapMode="word">
                  {session().share!.url}
                </text>
              </Match>
              <Match when={true}>
                <text fg={theme.text} wrapMode="word">
                  /share <span style={{ fg: theme.textMuted }}>to create a shareable link</span>
                </text>
              </Match>
            </Switch>
          </box>
          <ContextInfo context={context} cost={cost} />
        </box>
      </Show>
    </box>
  )
}
