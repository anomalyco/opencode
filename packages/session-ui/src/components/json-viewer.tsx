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
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true
  }
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== "object") return false
  return Object.values(value).every(isJsonValue)
}

export function parseJson(json: string): { value: JsonValue; valid: boolean } {
  try {
    const value: unknown = JSON.parse(json)
    return isJsonValue(value) ? { value, valid: true } : { value: null, valid: false }
  } catch {
    return { value: null, valid: false }
  }
}

export function jsonKeys(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.map((_, index) => String(index))
  if (value !== null && typeof value === "object") return Object.keys(value)
  return []
}

function JsonNode(props: { value: JsonValue; keyName?: string; depth: number }) {
  const [expanded, setExpanded] = createSignal(props.depth < 2)

  const isContainer = () => typeof props.value === "object" && props.value !== null
  const isArray = () => Array.isArray(props.value)
  const keys = () => jsonKeys(props.value)
  const isEmpty = () => keys().length === 0
  const valueFor = (key: string) => {
    if (Array.isArray(props.value)) return props.value[Number(key)]
    if (props.value !== null && typeof props.value === "object") return props.value[key]
    return null
  }

  const primitiveClass = () => {
    if (props.value === null) return "json-null"
    return PRIMITIVE_CLASS[typeof props.value] ?? "json-null"
  }
  const primitiveDisplay = () => {
    const value = props.value
    if (typeof value === "string") return `"${escapeJsonString(value)}"`
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    return "null"
  }

  return (
    <Show
      when={isContainer()}
      fallback={
        <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
          <Show when={props.keyName !== undefined}>
            <span class="json-key">{props.keyName}: </span>
          </Show>
          <span class={primitiveClass()}>{primitiveDisplay()}</span>
        </div>
      }
    >
      <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
        <Show when={props.keyName !== undefined}>
          <span class="json-key">{props.keyName}: </span>
        </Show>
        <Show when={!isEmpty()}>
          <button
            class="json-toggle"
            classList={{ "json-toggle--expanded": expanded() }}
            aria-expanded={expanded()}
            aria-label={props.keyName !== undefined ? `Toggle ${props.keyName}` : "Toggle"}
            onClick={() => setExpanded((e) => !e)}
          >
            <Icon name="chevron-right" size="small" />
          </button>
        </Show>
        <span class="json-bracket">{isArray() ? "[" : "{"}</span>
        <Show when={isEmpty()}>
          <span class="json-bracket">{isArray() ? "]" : "}"}</span>
        </Show>
        <Show when={!isEmpty() && !expanded()}>
          <span class="json-ellipsis">...</span>
          <span class="json-bracket">{isArray() ? "]" : "}"}</span>
        </Show>
      </div>
      <Show when={!isEmpty() && expanded()}>
        <For each={keys()}>{(key) => <JsonNode value={valueFor(key)} keyName={key} depth={props.depth + 1} />}</For>
        <div class="json-row" style={{ "padding-left": `${props.depth * 16}px` }}>
          <span class="json-bracket">{isArray() ? "]" : "}"}</span>
        </div>
      </Show>
    </Show>
  )
}

export function JsonViewer(props: { json: string; class?: string }) {
  const [state, setState] = createStore<{ value: JsonValue; valid: boolean }>({ value: null, valid: false })

  createEffect(() => {
    const parsed = parseJson(props.json)
    if (parsed.valid) setState(reconcile(parsed))
    else setState("valid", false)
  })

  return (
    <Show when={state.valid} fallback={<div class={props.class}>{props.json}</div>}>
      <div class={`json-viewer ${props.class ?? ""}`}>
        <JsonNode value={state.value} depth={0} />
      </div>
    </Show>
  )
}
