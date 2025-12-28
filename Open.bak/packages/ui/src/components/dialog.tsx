import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ComponentProps, JSXElement, Match, ParentProps, Show, Switch } from "solid-js"
import { IconButton } from "./icon-button"

export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function Dialog(props: DialogProps) {
  return (
    <div data-component="dialog">
      <div data-slot="dialog-container">
        <Kobalte.Content
          data-slot="dialog-content"
          classList={{
            ...(props.classList ?? {}),
            [props.class ?? ""]: !!props.class,
          }}
          onOpenAutoFocus={(e) => {
            const target = e.currentTarget as HTMLElement | null
            const autofocusEl = target?.querySelector("[autofocus]") as HTMLElement | null
            if (autofocusEl) {
              e.preventDefault()
              autofocusEl.focus()
            }
          }}
        >
          <Show when={props.title || props.action}>
            <div data-slot="dialog-header">
              <Show when={props.title}>
                <Kobalte.Title data-slot="dialog-title">{props.title}</Kobalte.Title>
              </Show>
              <Switch>
                <Match when={props.action}>{props.action}</Match>
                <Match when={true}>
                  <Kobalte.CloseButton data-slot="dialog-close-button" as={IconButton} icon="close" variant="ghost" />
                </Match>
              </Switch>
            </div>
          </Show>
          <Show when={props.description}>
            <Kobalte.Description data-slot="dialog-description">{props.description}</Kobalte.Description>
          </Show>
          <div data-slot="dialog-body">{props.children}</div>
        </Kobalte.Content>
      </div>
    </div>
  )
}
