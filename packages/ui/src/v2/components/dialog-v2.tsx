import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { type ComponentProps, type JSXElement, type ParentProps, Show, children, splitProps } from "solid-js"
import "./dialog-v2.css"

export interface DialogProps extends ParentProps {
  title?: JSXElement
  description?: JSXElement
  action?: JSXElement
  size?: "normal" | "large" | "x-large"
  variant?: "default" | "settings"
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
}

export function DialogFooter(props: ParentProps) {
  return <div data-slot="dialog-footer">{props.children}</div>
}

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    "title",
    "description",
    "action",
    "size",
    "variant",
    "class",
    "classList",
    "fit",
    "children",
  ])
  const title = children(() => local.title)
  const description = children(() => local.description)
  const action = children(() => local.action)
  const hasHeader = () => title() || action()

  return (
    <div
      data-component="dialog-v2"
      data-variant={local.variant === "settings" ? "settings" : undefined}
      data-fit={local.fit ? true : undefined}
      data-size={local.size || "normal"}
    >
      <div data-slot="dialog-container">
        <Kobalte.Content
          data-slot="dialog-content"
          data-no-header={!hasHeader() ? "" : undefined}
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
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
          <Show when={hasHeader()}>
            <div data-slot="dialog-header">
              <div data-slot="dialog-title-group">
                <Show when={title()}>{(t) => <Kobalte.Title data-slot="dialog-title">{t()}</Kobalte.Title>}</Show>
                <Show when={description()}>
                  {(d) => <Kobalte.Description data-slot="dialog-description">{d()}</Kobalte.Description>}
                </Show>
              </div>
              <Show when={action()}>{(a) => a()}</Show>
              <Kobalte.CloseButton data-slot="dialog-close-button" aria-label="Close">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12.4446 3.55469L3.55566 12.4436M3.55566 3.55469L12.4446 12.4436"
                    stroke="#808080"
                    stroke-linejoin="round"
                  />
                </svg>
              </Kobalte.CloseButton>
            </div>
          </Show>
          <div data-slot="dialog-body">{local.children}</div>
        </Kobalte.Content>
      </div>
    </div>
  )
}
