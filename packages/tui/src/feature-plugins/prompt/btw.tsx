import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { createSignal, Show } from "solid-js"
import { Spinner } from "../../component/spinner"
import { useConfig } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { useDialog } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import { getScrollAcceleration } from "../../util/scroll"

// session.generate exposes the session's tools but runs no tool loop, so a
// tool call would surface as an empty answer.
const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

export default Plugin.define({
  id: "opencode.btw",
  setup(context) {
    const [pending, setPending] = createSignal(0)

    context.ui.slot({
      append: "prompt.footer.status",
      render: () => {
        const theme = useTheme()
        return (
          <Show when={pending() > 0}>
            <box flexShrink={0}>
              <Spinner color={theme.text.status.running}>/btw</Spinner>
            </box>
          </Show>
        )
      },
    })

    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        const renderNode = usePlugin().markdown
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
                const question =
                  input?.trim() || (await context.ui.dialog.prompt({ title: "/btw", placeholder: "Ask anything" }))
                if (!question) return
                setPending((count) => count + 1)
                await context.client.session
                  .generate({ sessionID: route.sessionID, prompt: [instructions, question].join("\n\n") })
                  .then((result) => {
                    context.ui.dialog.show(() => (
                      <Answer question={question} answer={result.text.trim()} renderNode={renderNode()} />
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
  },
})

function Answer(props: {
  question: string
  answer: string
  renderNode: ReturnType<ReturnType<typeof usePlugin>["markdown"]>
}) {
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()
  const theme = useTheme().surface("dialog")
  const overlay = useTheme()
  const syntax = useThemes().currentSyntax
  const config = useConfig().data
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
    if (event.name === "up") return scroll.scrollBy(-1)
    if (event.name === "down") return scroll.scrollBy(1)
    if (event.name === "pageup") return scroll.scrollBy(-20)
    if (event.name === "pagedown") return scroll.scrollBy(20)
    if (event.name === "home") return scroll.scrollTo(0)
    if (event.name === "end") return scroll.scrollTo(scroll.scrollHeight)
  })

  return (
    <box gap={1}>
      <box paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
            /btw
          </text>
          <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.text.subdued} wrapMode="word">
            {props.question}
          </text>
        </box>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        maxHeight={20}
        backgroundColor={overlay.background.raised.high}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
          <markdown
            syntaxStyle={syntax()}
            renderNode={props.renderNode}
            content={props.answer}
            conceal
            internalBlockMode="top-level"
            tableOptions={{ style: "grid", cellPaddingX: 1 }}
            fg={overlay.markdown.text}
            bg={overlay.background.raised.high}
          />
        </box>
      </scrollbox>
      <box flexDirection="row" gap={3} paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text onMouseUp={copy}>
          <span style={{ fg: copied() ? theme.text.feedback.success.default : theme.text.default }}>
            <b>{copied() ? "✓ copied" : "c"}</b>
          </span>
          <span style={{ fg: theme.text.subdued }}>{copied() ? "" : " copy"}</span>
        </text>
        <text fg={theme.text.subdued}>↑/↓ scroll</text>
      </box>
    </box>
  )
}
