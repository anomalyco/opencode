/** @jsx h */

import h from "solid-js/h"
import { Component, For, Show } from "solid-js"
import type { ContextItem, MessageContextItem } from "@/context/prompt"

const styles = `
[data-component="line-comment"] {
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-start;
}

[data-component="line-comment"][data-open] {
  z-index: var(--line-comment-open-z, 100);
}

[data-component="line-comment"] [data-slot="line-comment-popover"] {
  position: relative;
  flex: 1 1 0%;
  width: auto;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border-radius: 14px;
  background: var(--surface-raised-stronger-non-alpha);
  box-shadow: var(--shadow-xxs-border);
  padding: 8px;
}

[data-component="line-comment"] [data-slot="line-comment-content"] {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-head"] {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-text"] {
  flex: 1;
  min-width: 0;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-regular);
  line-height: var(--line-height-x-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--text-strong);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-component="line-comment"] [data-slot="line-comment-tools"] {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-label"] {
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-large);
  letter-spacing: var(--letter-spacing-normal);
  color: var(--text-weak);
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

[data-component="line-comment"] [data-slot="line-comment-editor"] {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

[data-component="line-comment"] [data-slot="line-comment-textarea"] {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  padding: 8px;
  border-radius: var(--radius-md);
  background: var(--surface-base);
  border: 1px solid var(--border-base);
  color: var(--text-strong);
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  line-height: var(--line-height-large);
}

[data-component="line-comment"] [data-slot="line-comment-textarea"]:focus {
  outline: none;
  box-shadow: var(--shadow-xs-border-select);
}

[data-component="line-comment"] [data-slot="line-comment-action"] {
  border: 1px solid var(--border-base);
  background: var(--surface-base);
  color: var(--text-strong);
  border-radius: var(--radius-md);
  height: 28px;
  padding: 0 10px;
  font-family: var(--font-family-sans);
  font-size: var(--font-size-small);
  font-weight: var(--font-weight-medium);
}

[data-component="line-comment"] [data-slot="line-comment-action"][data-variant="ghost"] {
  background: transparent;
}
`

let installed = false

function install() {
  if (installed) return
  if (typeof document === "undefined") return

  const id = "opencode-message-annotation-line-comment-styles"
  if (document.getElementById(id)) {
    installed = true
    return
  }

  const style = document.createElement("style")
  style.id = id
  style.textContent = styles
  document.head.appendChild(style)
  installed = true
}

install()

type Entry = ContextItem & { key: string }
type FileItem = Entry & { type: "file" }
type Item = MessageContextItem & {
  key: string
  path: never
  selection?: never
  commentID?: never
  commentOrigin?: never
}

type MessageAnnotationsProps = {
  items: Item[]
  update: (annotationID: string, next: Omit<Partial<MessageContextItem>, "annotationID" | "type">) => void
  remove: (annotationID: string) => void
  placeholder: string
  deleteLabel: string
}

export const contextFiles = (items: Entry[], mode: "normal" | "shell") => {
  const list = items.filter((item): item is FileItem => item.type === "file")
  if (mode !== "shell") return list
  return list.filter((item) => !item.comment?.trim())
}

export const contextMessages = (items: Entry[], mode: "normal" | "shell") => {
  if (mode === "shell") return []
  return items.filter((item): item is Item => item.type === "message")
}

const line = (item: Item) => item.preview?.trim() || item.quote.replace(/\s+/g, " ").trim()

export const MessageAnnotations: Component<MessageAnnotationsProps> = (props) => {
  return (
    <Show when={props.items.length > 0}>
      <div
        data-component="message-annotation-basket"
        data-message-selection-ignore="true"
        class="px-2 pt-2 flex flex-col gap-2"
      >
        <For each={props.items}>
          {(item) => (
            <div
              data-component="line-comment"
              data-prevent-autofocus=""
              data-variant="editor"
              data-comment-id={item.annotationID}
              data-open=""
              data-inline=""
            >
              <div data-slot="line-comment-popover" data-inline-body="">
                <div data-slot="line-comment-editor">
                  <div data-slot="line-comment-content">
                    <div data-slot="line-comment-head">
                      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <span
                          classList={{
                            "shrink-0 rounded-md px-1.5 py-0.5 text-10-medium uppercase tracking-wide": true,
                            "bg-surface-base text-syntax-property": item.role === "user",
                            "bg-surface-interactive-hover text-syntax-type": item.role === "assistant",
                          }}
                        >
                          {item.role}
                        </span>
                        <div data-slot="line-comment-label" class="flex-1 truncate">
                          {line(item)}
                        </div>
                      </div>
                      <div data-slot="line-comment-tools">
                        <button
                          type="button"
                          data-slot="line-comment-action"
                          data-variant="ghost"
                          onClick={() => props.remove(item.annotationID)}
                          aria-label={props.deleteLabel}
                        >
                          {props.deleteLabel}
                        </button>
                      </div>
                    </div>
                    <div
                      data-slot="line-comment-text"
                      class="max-h-36 overflow-auto rounded-md border border-border-base bg-surface-base p-2"
                    >
                      {item.quote}
                    </div>
                  </div>

                  <textarea
                    data-slot="line-comment-textarea"
                    rows={Math.max(item.comment?.split("\n").length ?? 1, 2)}
                    value={item.comment ?? ""}
                    placeholder={props.placeholder}
                    onInput={(event) => props.update(item.annotationID, { comment: event.currentTarget.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}
