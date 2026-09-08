import type { JSX, ParentProps } from "solid-js"

/** Shared layout primitives for composed extension UI. Visual choices remain semantic. */
export function Stack(
  props: ParentProps<{ gap?: "none" | "small" | "medium"; padding?: "none" | "small" | "medium" }>,
) {
  return (
    <div
      data-component="stack"
      class="min-w-0 min-h-0 h-full flex flex-col bg-v2-background-bg-base"
      classList={{
        "gap-2": props.gap === "small",
        "gap-4": props.gap === "medium",
        "p-2": props.padding === "small",
        "p-4": props.padding === "medium",
      }}
    >
      {props.children}
    </div>
  )
}

export function Toolbar(props: ParentProps) {
  return (
    <div
      data-component="toolbar"
      class="h-10 shrink-0 flex items-center gap-1 px-2 border-b border-v2-border-border-muted bg-v2-background-bg-layer-02"
    >
      {props.children}
    </div>
  )
}

export function InlineForm(props: ParentProps<{ onSubmit: () => void }>) {
  return (
    <form
      class="min-w-0 flex-1"
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
    >
      {props.children}
    </form>
  )
}

export function Text(props: ParentProps<{ tone?: "default" | "muted" | "error" }>) {
  return (
    <span
      data-component="text"
      class="text-12-regular"
      classList={{
        "text-v2-text-text-base": !props.tone || props.tone === "default",
        "text-v2-text-text-muted": props.tone === "muted",
        "text-text-danger-base": props.tone === "error",
      }}
    >
      {props.children}
    </span>
  )
}

export function SettingsRow(props: {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}) {
  return (
    <div data-component="settings-row">
      <div data-slot="settings-row-copy">
        <div data-slot="settings-row-title">{props.title}</div>
        <div data-slot="settings-row-description">{props.description}</div>
      </div>
      <div data-slot="settings-row-control">{props.children}</div>
    </div>
  )
}
