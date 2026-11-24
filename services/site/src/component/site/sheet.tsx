import { type JSX, onCleanup, onMount } from "solid-js"
import { detectPlatform } from "~/lib/platform"
import { touchDevice } from "~/lib/user-agent"
import { onCloseMenus } from "./menu-open"
import type { SheetControl } from "./sheet-motion"
import "./sheet.css"

export type { SheetControl } from "./sheet-motion"

/** Touch phones and tablets get sheets, with the device preview's platform. */
export function prefersSheet(platform = detectPlatform()) {
  return touchDevice(platform)
}

/**
 * A bottom sheet: what a dropdown becomes on a touch phone (sheet-motion.ts drives it). It is a
 * popover in the top layer, so no card or carousel clips it; with an `id`, a `popovertarget` button
 * opens it without JavaScript too.
 */
export function Sheet(props: {
  /** For `popovertarget` buttons, which open the sheet before the code has loaded. */
  id?: string
  /** Names the sheet for its own styles: `data-sheet`. */
  name: string
  /** The dialog's accessible name; the sheet shows no title. */
  label: string
  control: (control: SheetControl) => void
  children: JSX.Element
}) {
  let root!: HTMLDivElement
  // Its motion (sheet-motion.ts) loads once the sheet mounts on a touch device (the site renders its
  // language sheet on every page), else when something opens it.
  let motion: Promise<ReturnType<(typeof import("./sheet-motion"))["sheetMotion"]>> | undefined
  const load = () => (motion ??= import("./sheet-motion").then(({ sheetMotion }) => sheetMotion(root)))

  onCloseMenus(() => void motion?.then((sheet) => sheet.close()))

  onMount(() => {
    if (prefersSheet()) void load()
    props.control({
      open: (trigger) => void load().then((sheet) => sheet.open(trigger)),
      close: () => void motion?.then((sheet) => sheet.close()),
    })
    onCleanup(() => void motion?.then((sheet) => sheet.stop()))
  })

  return (
    <div
      ref={root}
      id={props.id}
      popover="manual"
      data-component="sheet"
      data-sheet={props.name}
      role="dialog"
      aria-modal="true"
      aria-label={props.label}
    >
      <div data-slot="backdrop" aria-hidden="true" />
      <div data-slot="panel">
        <div data-slot="head">
          <button type="button" data-slot="grabber" aria-label={props.label} />
        </div>
        <div data-slot="body">{props.children}</div>
      </div>
    </div>
  )
}
