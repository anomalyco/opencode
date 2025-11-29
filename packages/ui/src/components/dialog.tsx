import {
  Dialog as Kobalte,
  DialogRootProps,
  DialogTitleProps,
  DialogCloseButtonProps,
  DialogDescriptionProps,
} from "@kobalte/core/dialog"
import { ComponentProps, type JSX, onCleanup, Show, splitProps } from "solid-js"
import { IconButton } from "./icon-button"

export interface DialogProps extends DialogRootProps {
  trigger?: JSX.Element
  class?: ComponentProps<"div">["class"]
  classList?: ComponentProps<"div">["classList"]
}

export function DialogRoot(props: DialogProps) {
  let trigger!: HTMLElement
  const [local, others] = splitProps(props, ["trigger", "class", "classList", "children"])

  const resetTabIndex = () => {
    trigger.tabIndex = 0
  }

  const handleTriggerFocus = (e: FocusEvent & { currentTarget: HTMLElement | null }) => {
    const firstChild = e.currentTarget?.firstElementChild as HTMLElement
    if (!firstChild) return

    firstChild.focus()
    trigger.tabIndex = -1

    firstChild.addEventListener("focusout", resetTabIndex)
    onCleanup(() => {
      firstChild.removeEventListener("focusout", resetTabIndex)
    })
  }

  return (
    <Kobalte {...others}>
      <Show when={props.trigger}>
        <Kobalte.Trigger ref={trigger} data-component="dialog-trigger" onFocusIn={handleTriggerFocus}>
          {props.trigger}
        </Kobalte.Trigger>
      </Show>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" />
        <div data-component="dialog">
          <div data-slot="dialog-container">
            <Kobalte.Content
              data-slot="dialog-content"
              classList={{
                ...(local.classList ?? {}),
                [local.class ?? ""]: !!local.class,
              }}
            >
              {local.children}
            </Kobalte.Content>
          </div>
        </div>
      </Kobalte.Portal>
    </Kobalte>
  )
}

function DialogHeader(props: ComponentProps<"div">) {
  return <div data-slot="dialog-header" {...props} />
}

function DialogBody(props: ComponentProps<"div">) {
  return <div data-slot="dialog-body" {...props} />
}

function DialogTitle(props: DialogTitleProps & ComponentProps<"h2">) {
  return <Kobalte.Title data-slot="dialog-title" {...props} />
}

function DialogDescription(props: DialogDescriptionProps & ComponentProps<"p">) {
  return <Kobalte.Description data-slot="dialog-description" {...props} />
}

function DialogCloseButton(props: DialogCloseButtonProps & ComponentProps<"button">) {
  return <Kobalte.CloseButton data-slot="dialog-close-button" as={IconButton} icon="close" {...props} />
}

export const Dialog = Object.assign(DialogRoot, {
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  CloseButton: DialogCloseButton,
  Body: DialogBody,
})
