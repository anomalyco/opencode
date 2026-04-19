import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"

type Props = {
  setRef: (node: HTMLTextAreaElement) => void
  text: string
  busy: boolean
  loading: boolean
  ready: boolean
  clear: boolean
  context: boolean
  onText: (text: string) => void
  onClose: () => void
  onReset: () => void
  onContext: () => void
  onSend: () => void
}

export function QuickAssistantInput(props: Props) {
  return (
    <div class="flex items-end gap-3 px-4 py-4">
      <textarea
        ref={props.setRef}
        rows={3}
        value={props.text}
        placeholder="Ask about the current OpenCode session or a quick task..."
        class="min-h-18 flex-1 resize-none bg-transparent text-14-regular text-text-strong outline-none placeholder:text-text-weaker"
        onInput={(event) => props.onText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            props.onClose()
            return
          }
          if (event.key !== "Enter" || event.shiftKey) return
          event.preventDefault()
          if (props.busy) {
            props.onReset()
            return
          }
          props.onSend()
        }}
      />
      <div class="flex shrink-0 items-center gap-2">
        <button
          type="button"
          class="flex size-10 items-center justify-center rounded-full border border-border-weak-base bg-background-base text-text-strong shadow-xs-border transition-colors hover:border-border-strong-base hover:bg-surface-base-hover active:bg-surface-base-active"
          onClick={props.onReset}
          aria-label={props.clear ? "Clear assistant" : "New assistant"}
          title={props.clear ? "Clear" : "New"}
        >
          <Icon name="new-session" class="size-4.5" />
        </button>
        <button
          type="button"
          class="flex size-10 items-center justify-center rounded-full border border-border-weak-base bg-background-base text-text-strong shadow-xs-border transition-colors"
          classList={{
            "border-border-success-base bg-surface-success-base text-text-on-success-base hover:border-border-success-hover active:border-border-success-selected":
              props.context,
            "text-text-weaker hover:border-border-strong-base hover:bg-surface-base-hover hover:text-text-strong active:bg-surface-base-active":
              !props.context,
          }}
          onClick={props.onContext}
          aria-pressed={props.context}
          aria-label={props.context ? "Disable current session context" : "Enable current session context"}
          title={props.context ? "Current session context on" : "Current session context off"}
        >
          <Icon name="link" class="size-4.5" />
        </button>
        <IconButton
          type="button"
          icon={props.busy ? "stop" : "arrow-up-bold"}
          variant="primary"
          iconSize={props.busy ? "normal" : "medium"}
          class="size-10 rounded-full shadow-xs-border disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!props.busy && (props.loading || !props.ready || !props.text.trim())}
          onClick={() => {
            if (props.busy) {
              props.onReset()
              return
            }
            props.onSend()
          }}
          aria-label={props.busy ? "Stop" : "Send"}
          title={props.busy ? "Stop" : "Send"}
        />
      </div>
    </div>
  )
}
