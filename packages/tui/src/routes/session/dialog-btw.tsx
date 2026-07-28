import { ScrollBoxRenderable, TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { Spinner } from "../../component/spinner"
import { useDialog } from "../../ui/dialog"
import { useTuiConfig } from "../../config"
import { useBindings } from "../../keymap"
import { errorMessage } from "../../util/error"
import { getScrollAcceleration } from "../../util/scroll"

export type BtwExchange = {
  question: string
  answer: string
  providerID: string
  modelID: string
}

export function DialogBtw(props: {
  sessionID: string
  initialQuestion?: string
  exchanges: readonly BtwExchange[]
  onChange: (exchanges: BtwExchange[]) => void
}) {
  const sdk = useSDK()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const { theme, syntax } = useTheme()
  const tuiConfig = useTuiConfig()
  const scrollAcceleration = () => getScrollAcceleration(tuiConfig)
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  const [exchanges, setExchanges] = createSignal([...props.exchanges])
  const [busy, setBusy] = createSignal(false)
  const [pending, setPending] = createSignal("")
  const [failure, setFailure] = createSignal("")
  let textarea: TextareaRenderable
  let scroll: ScrollBoxRenderable
  let request: AbortController | undefined

  const height = () => Math.max(14, Math.min(36, dimensions().height - 8))

  function focusInput() {
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed || busy()) return
      textarea.focus()
    }, 1)
  }

  async function ask(value?: string) {
    const question = (value ?? textarea?.plainText ?? "").trim()
    if (!question || busy()) return

    setFailure("")
    setPending(question)
    setBusy(true)
    if (textarea && !textarea.isDestroyed) {
      textarea.clear()
      textarea.blur()
    }

    const ctrl = new AbortController()
    request = ctrl
    try {
      const response = await sdk.client.session.btw(
        {
          sessionID: props.sessionID,
          question,
          exchanges: exchanges()
            .slice(-8)
            .map((exchange) => ({ question: exchange.question, answer: exchange.answer })),
        },
        { throwOnError: true, signal: ctrl.signal },
      )
      if (!response.data) throw new Error("The /btw request returned no answer")
      const next = [
        ...exchanges(),
        {
          question,
          answer: response.data.answer,
          providerID: response.data.providerID,
          modelID: response.data.modelID,
        },
      ].slice(-12)
      setExchanges(next)
      props.onChange(next)
      setTimeout(() => scroll?.scrollBy(100_000), 1)
    } catch (error) {
      if (!ctrl.signal.aborted) {
        setFailure(errorMessage(error))
        if (textarea && !textarea.isDestroyed) textarea.setText(question)
      }
    } finally {
      if (request === ctrl) request = undefined
      if (!ctrl.signal.aborted) {
        setBusy(false)
        setPending("")
        focusInput()
      }
    }
  }

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined && !busy(),
    priority: 1,
    commands: [
      {
        name: "dialog.prompt.submit",
        title: "Ask BTW question",
        category: "Dialog",
        run: () => void ask(),
      },
    ],
    bindings: tuiConfig.keybinds.gather("dialog.prompt", ["dialog.prompt.submit"]),
  }))

  onMount(() => {
    dialog.setSize("large")
    const initial = props.initialQuestion?.trim()
    if (initial) void ask(initial)
    else focusInput()
  })

  createEffect(() => {
    if (!textarea || textarea.isDestroyed) return
    textarea.traits = busy() ? { suspend: true, status: "BUSY" } : {}
  })

  onCleanup(() => request?.abort())

  return (
    <box height={height()} paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          BTW · side conversation
        </text>
        <text fg={theme.textMuted}>esc return to main</text>
      </box>
      <text fg={theme.textMuted}>same context · independent model call · no tools · main task keeps running</text>

      <scrollbox
        ref={(value: ScrollBoxRenderable) => (scroll = value)}
        flexGrow={1}
        scrollAcceleration={scrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: { backgroundColor: theme.backgroundPanel, foregroundColor: theme.borderActive },
        }}
      >
        <box gap={1} paddingRight={1}>
          <Show when={exchanges().length === 0 && !busy()}>
            <text fg={theme.textMuted}>
              Ask a quick question about the current work. Answers stay out of the main history.
            </text>
          </Show>
          <For each={exchanges()}>
            {(exchange) => (
              <box gap={1}>
                <text fg={theme.text}>
                  <span style={{ fg: theme.primary }}>You · </span>
                  {exchange.question}
                </text>
                <box paddingLeft={2}>
                  <markdown
                    syntaxStyle={syntax()}
                    streaming={false}
                    internalBlockMode="top-level"
                    content={exchange.answer}
                    tableOptions={{ style: "grid" }}
                    conceal={true}
                    fg={theme.markdownText}
                    bg={theme.backgroundPanel}
                  />
                </box>
                <text fg={theme.textMuted}>
                  {exchange.providerID}/{exchange.modelID}
                </text>
              </box>
            )}
          </For>
          <Show when={busy()}>
            <box gap={1}>
              <text fg={theme.text}>
                <span style={{ fg: theme.primary }}>You · </span>
                {pending()}
              </text>
              <Spinner color={theme.accent}>Asking side model…</Spinner>
            </box>
          </Show>
        </box>
      </scrollbox>

      <Show when={failure()}>
        <text fg={theme.error}>{failure()}</text>
      </Show>
      <textarea
        height={3}
        ref={(value: TextareaRenderable) => {
          textarea = value
          setTextareaTarget(value)
        }}
        placeholder="Ask another question…"
        placeholderColor={theme.textMuted}
        textColor={busy() ? theme.textMuted : theme.text}
        focusedTextColor={busy() ? theme.textMuted : theme.text}
        cursorColor={busy() ? theme.backgroundElement : theme.text}
      />
      <text fg={theme.textMuted}>enter ask · esc close and return</text>
    </box>
  )
}
