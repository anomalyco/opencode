import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal, Match, Show, Switch } from "solid-js"
import { Spinner } from "../../component/spinner"
import { useConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { DIALOG_INSET, DialogBleed, DialogFooter, DialogHeader, DialogLayout } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { getScrollAcceleration } from "../../util/scroll"
import { sideQuestionPrompt } from "@opencode/util/side-chat"
import { createSideChat, SIDE_CHAT_PANEL, SideChatPanel } from "./btw-side-chat"

export default Plugin.define({
  id: "opencode.btw",
  setup(context) {
    const [pending, setPending] = createSignal(0)
    const chat = createSideChat(context)
    // The side_chat feature flag as the server resolves it, undefined until a read succeeds: setup can run before the
    // client connects. A server without the endpoint keeps the one-shot dialog.
    const [sideChat, setSideChat] = createSignal<boolean>()
    const readFlag = () =>
      context.client.experimental.config
        .flags({ location: context.location })
        .then((flags) => setSideChat(flags.side_chat.enabled))
        .catch(() => false)
    void readFlag()
    const stopFlag = context.data.on("config.updated", () => void readFlag())

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        const theme = useTheme()
        const busy = () => pending() > 0 || (sideChat() && !!input.sessionID && chat.busy(input.sessionID))
        // A closed side chat with threads stays one click away.
        const parked = () => {
          if (!sideChat() || !input.sessionID || busy()) return 0
          const open = context.ui.panel.current()
          if (open?.name === SIDE_CHAT_PANEL && open.sessionID === input.sessionID) return 0
          return chat.threads(input.sessionID).length
        }
        return (
          <Switch>
            <Match when={busy()}>
              <box flexShrink={0}>
                <Spinner color={theme.hue.interactive[200]}>/btw</Spinner>
              </box>
            </Match>
            <Match when={parked() > 0}>
              <box flexShrink={0} onMouseUp={() => context.ui.panel.open(SIDE_CHAT_PANEL)}>
                <text fg={theme.text.muted}>{`/btw ${parked()}`}</text>
              </box>
            </Match>
          </Switch>
        )
      },
    })

    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === SIDE_CHAT_PANEL}>
          <SideChatPanel chat={chat} context={context} panel={panel} />
        </Show>
      ),
    })

    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        // Dialogs render beside PluginProvider, so Answer cannot call usePlugin().
        const plugins = usePlugin()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "session.aside",
              title: "Ask a side question",
              description: "One-shot answer from the session's context without adding to the conversation",
              group: "Session",
              palette: true,
              slash: { name: "btw", arguments: true },
              async run(input) {
                const route = context.ui.router.current()
                if (route.type !== "session") {
                  toast.show({ message: "Open a session first", variant: "warning" })
                  return
                }
                if (sideChat() ?? (await readFlag())) {
                  const question = input?.trim()
                  if (question) chat.start(route.sessionID, question)
                  context.ui.panel.open(SIDE_CHAT_PANEL)
                  chat.requestFocus()
                  return
                }
                const question =
                  input?.trim() || (await context.ui.dialog.prompt({ title: "/btw", placeholder: "Ask anything" }))
                if (!question) return
                setPending((count) => count + 1)
                await context.client.session
                  .generate({ sessionID: route.sessionID, prompt: sideQuestionPrompt(question) })
                  .then((result) => {
                    context.ui.dialog.show(() => (
                      <Answer question={question} answer={result.text.trim()} markdown={plugins.markdown} />
                    ))
                    context.ui.dialog.set({ size: "large", centered: true })
                  })
                  .catch((cause: unknown) => toast.error(cause))
                  .finally(() => setPending((count) => count - 1))
              },
            },
          ],
        }))
        return null
      },
    })

    return () => {
      stopFlag()
      chat.dispose()
    }
  },
})

export function Answer(props: {
  question: string
  answer: string
  markdown: ReturnType<typeof usePlugin>["markdown"]
}) {
  const toast = useToast()
  const clipboard = useClipboard()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const syntax = useThemes().currentSyntax
  const config = useConfig().data
  const dimensions = useTerminalDimensions()
  const maxHeight = createMemo(() => Math.max(8, Math.floor(dimensions().height * 0.6)))
  const [copied, setCopied] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined

  const copy = () => {
    void clipboard
      .write(props.answer)
      .then(() => setCopied(true))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [{ bind: "c", title: "Copy answer", group: "Dialog", run: copy }],
  }))

  useKeyboard((event) => {
    if (!scroll) return
    if (event.name === "up" || event.name === "k") return scroll.scrollBy(-1)
    if (event.name === "down" || event.name === "j") return scroll.scrollBy(1)
    if (event.name === "pageup") return scroll.scrollBy(-maxHeight())
    if (event.name === "pagedown") return scroll.scrollBy(maxHeight())
    if (event.name === "home") return scroll.scrollTo(0)
    if (event.name === "end") return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <DialogLayout
      header={
        <DialogHeader
          gap={2}
          titleView={
            <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
              /btw
            </text>
          }
        >
          <text fg={theme.text.muted} wrapMode="none" flexGrow={1} truncate>
            {props.question.replace(/\s+/g, " ")}
          </text>
        </DialogHeader>
      }
      footer={{
        actions: {
          primary: [
            copied()
              ? { title: "✓ copied", color: theme.text.feedback.success.base, onTrigger: copy }
              : { title: "copy response", key: "c", onTrigger: copy },
          ],
        },
      }}
      legacyFooter={
        <DialogFooter
          actions={{
            secondary: [
              copied()
                ? { title: "✓ copied", color: theme.text.feedback.success.base, onTrigger: copy }
                : { title: "copy", key: "c", onTrigger: copy },
              { title: "scroll", key: "j/k ↑/↓" },
            ],
          }}
        />
      }
    >
      <DialogBleed>
        <scrollbox
          ref={(element: ScrollBoxRenderable) => (scroll = element)}
          maxHeight={maxHeight()}
          contentOptions={{ minHeight: 0 }}
          backgroundColor={overlay.background.raised.high}
          scrollbarOptions={{ visible: false }}
          scrollAcceleration={getScrollAcceleration(config)}
        >
          <box paddingLeft={DIALOG_INSET} paddingRight={DIALOG_INSET} paddingTop={1} paddingBottom={1}>
            <markdown
              syntaxStyle={syntax()}
              renderNode={props.markdown()}
              content={props.answer}
              conceal
              internalBlockMode="top-level"
              tableOptions={{ style: "grid", cellPaddingX: 1 }}
              fg={overlay.markdown.text}
              bg={overlay.background.raised.high}
            />
          </box>
        </scrollbox>
      </DialogBleed>
    </DialogLayout>
  )
}
