import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { ComponentProps, ParentProps } from "solid-js"

export type Props = ParentProps<{
  size?: "sm" | "md"
  transition?: boolean
}> &
  ComponentProps<typeof Kobalte>

export function Dialog(props: Props) {
  return (
    <Kobalte {...props}>
      <Kobalte.Portal>
        <Kobalte.Overlay data-component="dialog-overlay" />
        <div data-component="dialog-center">
          <Kobalte.Content
            data-transition={props.transition ? "" : undefined}
            data-size={props.size}
            data-slot="content"
          >
            {props.children}
          </Kobalte.Content>
        </div>
      </Kobalte.Portal>
    </Kobalte>
  )
}
