import { createEffect, createSignal, For, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

const PRIMITIVE_CLASS: Record<string, string> = {
  string: "json-string",
  number: "json-number",
  boolean: "json-boolean",
}

function escapeJsonString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
}

function JsonNode(props: { value: JsonValue; keyName?: string; depth: number }) {
  const [expanded, setExpanded] = createSignal(props.depth < 2)

  if (typeof props.value !== "object" || props.value === null) {
    const className = props.value === null ? "json-null" : (PRIMITIVE_CLASS[typeof props.value] ?? "json-null")
    const display =
      typeof props.value === "string"
        ? `"${escapeJsonString(props.value)}"`
        : String(props.value)
    return (
      <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
        <Show when={props.keyName !== undefined}>
          <span class="json-key">{props.keyName}: </span>
        </Show>
        <span class={className}>{display}</span>
      </div>
    )
  }

  const isArray = Array.isArray(props.value)
  const openBracket = isArray ? "[" : "{"
  const closeBracket = isArray ? "]" : "}"

  const isEmpty = () => {
    if (Array.isArray(props.value)) return props.value.length === 0
    return Object.keys(props.value).length === 0
  }

  const entries = () => {
    if (isArray) return (props.value as JsonValue[]).map((v, i) => [String(i), v] as [string, JsonValue])
    return Object.entries(props.value as Record<string, JsonValue>)
  }

  return (
    <div>
      <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
        <Show when={props.keyName !== undefined}>
          <span class="json-key">{props.keyName}: </span>
        </Show>
        <button
          class="json-toggle"
          classList={{ "json-toggle--expanded": expanded() }}
          aria-expanded={expanded()}
          aria-label={props.keyName !== undefined ? `Toggle ${props.keyName}` : "Toggle"}
          onClick={() => setExpanded((e) => !e)}
        >
          <Icon name="chevron-right" size="small" />
        </button>
        <span class="json-bracket">{openBracket}</span>
        <Show when={!expanded()}>
          <span class="json-ellipsis">...</span>
          <span class="json-bracket">{closeBracket}</span>
        </Show>
      </div>
      <Show when={expanded()}>
        <For each={entries()}>
          {([key, val]) => <JsonNode value={val} keyName={key} depth={props.depth + 1} />}
        </For>
        <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
          <span class="json-bracket">{closeBracket}</span>
        </div>
      </Show>
    </div>
  )
}

export function JsonViewer(props: { json: string; class?: string }) {
  const [state, setState] = createStore<{ value: JsonValue; valid: boolean }>({ value: null, valid: false })

  createEffect(() => {
    try {
      setState(reconcile({ value: JSON.parse(props.json), valid: true }))
    } catch {
      setState("valid", false)
    }
  })

  return (
    <Show when={state.valid} fallback={<div class={props.class}>{props.json}</div>}>
      <div class={`json-viewer ${props.class ?? ""}`}>
        <JsonNode value={state.value} depth={0} />
      </div>
    </Show>
  )
}