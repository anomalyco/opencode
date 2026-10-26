import { CloseButton, Content, Description, Title } from "@kobalte/core/dialog"
import {
  type ComponentProps,
  type JSXElement,
  type ParentProps,
  Show,
  children,
  createEffect,
  splitProps,
} from "solid-js"
import { useDialogLayer } from "../../context/dialog"
import { useI18n } from "../../context/i18n"
import "./dialog.css"

const TEXT_FIELD = [
  'input:not([type="hidden"], [type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="file"], [type="color"], [type="image"]):not(:disabled, [readonly])',
  "textarea:not(:disabled, [readonly])",
  '[contenteditable="true"]',
].join(", ")

export interface DialogProps extends ParentProps {
  size?: "normal" | "large" | "x-large"
  variant?: "default" | "settings"
  class?: ComponentProps<"div">["class"]
  containerClass?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
  fit?: boolean
  onCloseAutoFocus?: ComponentProps<typeof Content>["onCloseAutoFocus"]
  preventBackdropDismiss?: boolean
}

export interface DialogHeaderProps extends ParentProps {
  closeLabel?: string
  hideClose?: boolean
}

export interface DialogTitleGroupProps {
  title?: JSXElement
  description?: JSXElement
}

export function DialogFooter(props: ParentProps) {
  return <div data-slot="dialog-footer">{props.children}</div>
}

export function DialogBody(props: ParentProps & { class?: ComponentProps<"div">["class"] }) {
  const [local] = splitProps(props, ["class", "children"])

  return (
    <div data-slot="dialog-body" class={local.class}>
      {local.children}
    </div>
  )
}

export function DialogTitle(props: ParentProps) {
  return <Title data-slot="dialog-header-title">{props.children}</Title>
}

export function DialogTitleGroup(props: DialogTitleGroupProps) {
  const title = children(() => props.title)
  const description = children(() => props.description)

  return (
    <div data-slot="dialog-title-group">
      <Show when={title()}>{(t) => <Title data-slot="dialog-title">{t()}</Title>}</Show>
      <Show when={description()}>{(value) => <Description data-slot="dialog-description">{value()}</Description>}</Show>
    </div>
  )
}

export function DialogHeader(props: DialogHeaderProps) {
  const i18n = useI18n()
  const [local] = splitProps(props, ["closeLabel", "hideClose", "children"])
  const hideClose = () => local.hideClose === true

  return (
    <div data-slot="dialog-header" data-hide-close={hideClose() ? "" : undefined}>
      {local.children}
      <Show when={!hideClose()}>
        <CloseButton data-slot="dialog-close-button" aria-label={local.closeLabel ?? i18n.t("ui.common.close")}>
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
              stroke="currentColor"
              stroke-linejoin="round"
            />
          </svg>
        </CloseButton>
      </Show>
    </div>
  )
}

export function Dialog(props: DialogProps) {
  const [local] = splitProps(props, [
    "size",
    "variant",
    "class",
    "containerClass",
    "classList",
    "fit",
    "children",
    "onCloseAutoFocus",
    "preventBackdropDismiss",
  ])

  const layer = useDialogLayer()
  createEffect(() => layer?.setBackdropDismiss(!local.preventBackdropDismiss))

  return (
    <div
      data-component="dialog-v2"
      data-variant={local.variant === "settings" ? "settings" : undefined}
      data-fit={local.fit ? true : undefined}
      data-size={local.size || "normal"}
    >
      <div data-slot="dialog-container" class={local.containerClass}>
        <Content
          data-slot="dialog-content"
          onCloseAutoFocus={local.onCloseAutoFocus}
          onPointerDownOutside={(event) => {
            if (local.preventBackdropDismiss) event.preventDefault()
          }}
          onInteractOutside={(event) => {
            const target = event.target

            if (layer?.container && target instanceof Node && !layer.container.contains(target)) event.preventDefault()
          }}
          classList={{
            ...local.classList,
            [local.class ?? ""]: !!local.class,
          }}
          onOpenAutoFocus={(e) => {
            const content = e.currentTarget

            if (!(content instanceof HTMLElement)) return
            // Kobalte would focus the first tabbable element, usually the close button, which Escape already covers.
            e.preventDefault()
            // Kobalte attaches its focus trap after this event, so focusing now would leave the trap with no element
            // to return to. Deferring, as Kobalte's own autofocus does, also lets children that focus themselves on
            // mount keep that focus.
            setTimeout(() => {
              const autofocus = content.querySelector<HTMLElement>("[autofocus]")
              const active = document.activeElement

              const kept =
                active instanceof HTMLElement &&
                active !== content &&
                content.contains(active) &&
                !active.closest('[data-slot="dialog-close-button"]')
                  ? active
                  : undefined

              const field = Array.from(content.querySelectorAll<HTMLElement>(TEXT_FIELD)).find(
                (element) => element.getClientRects().length > 0,
              )

              const target = autofocus ?? kept ?? field ?? content
              target.focus({ preventScroll: true })
            })
          }}
        >
          {local.children}
        </Content>
      </div>
    </div>
  )
}
