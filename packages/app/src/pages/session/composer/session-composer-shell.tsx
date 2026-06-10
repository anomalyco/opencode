import type { ParentProps } from "solid-js"
import { createEffect, onCleanup } from "solid-js"

export function SessionComposerShell(
  props: ParentProps<{
    expanded: boolean
    centered?: boolean
    anchorLeft: number
    anchorBottom: number
    shellWidth?: number
    shellRight?: number
    shellHeight?: number
    shellMin: number
    shellRef?: (el: HTMLDialogElement) => void
  }>,
) {
  let dialog: HTMLDialogElement | undefined

  // show() does not use the top layer (only showModal does).
  createEffect(() => {
    const el = dialog
    if (!el) return
    if (props.expanded) {
      if (!el.open) el.show()
      return
    }
    if (el.open) el.close()
  })

  onCleanup(() => {
    if (dialog?.open) dialog.close()
  })

  const width = () => {
    if (props.shellRight !== undefined) {
      return `calc(${props.shellRight}px - ${props.anchorLeft}px)`
    }
    const px = props.shellWidth ?? Math.max(props.shellMin, window.innerWidth - props.anchorLeft)
    return `${px}px`
  }

  return (
    <dialog
      ref={(el) => {
        dialog = el
        props.shellRef?.(el)
      }}
      data-component={props.expanded ? "session-composer-expanded" : "session-composer-shell"}
      classList={{
        "pointer-events-auto": true,
        "relative w-full px-3": !props.expanded,
        "md:max-w-200 md:mx-auto 2xl:max-w-[1000px]": props.centered && !props.expanded,
        "fixed flex flex-col px-3": props.expanded,
      }}
      style={
        props.expanded
          ? {
              left: `${props.anchorLeft}px`,
              bottom: `${props.anchorBottom}px`,
              width: width(),
              height: `${props.shellHeight ?? props.shellMin}px`,
            }
          : undefined
      }
    >
      {props.children}
    </dialog>
  )
}
