import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { JSX, Show } from "solid-js"
import "./modal.css"

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  variant?: "black"
  children: JSX.Element
}

export function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <Kobalte
        modal
        open={props.open}
        preventScroll={false}
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
      >
        <Kobalte.Portal>
          <Kobalte.Overlay data-component="modal" data-slot="overlay" onClick={props.onClose}>
            <Kobalte.Content
              data-slot="content"
              data-variant={props.variant}
              onClick={(e) => e.stopPropagation()}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                const target = e.currentTarget as HTMLElement | null
                target?.focus({ preventScroll: true })
              }}
            >
              <Show when={props.title}>
                <Kobalte.Title data-slot="title">{props.title}</Kobalte.Title>
              </Show>
              {props.children}
            </Kobalte.Content>
          </Kobalte.Overlay>
        </Kobalte.Portal>
      </Kobalte>
    </Show>
  )
}
