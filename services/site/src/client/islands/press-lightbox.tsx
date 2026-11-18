import { createSignal, Show } from "solid-js"
import { Lightbox, type LightboxMedia } from "~/routes/press/media-gallery"
import { mount } from "../solid"

type Open = { product: number; item: number; from: HTMLElement }

const [open, setOpen] = createSignal<Open>()
let mounted: Promise<unknown> | undefined

/**
 * Opens the press gallery's lightbox (media-gallery.tsx) on a product's media, rendered at the end of
 * the gallery as the hydrated page does, from the media the server wrote for it. Closing gives focus
 * back to the thumbnail that opened it.
 */
export function show(gallery: HTMLElement, state: Open) {
  mounted ??= mount(() => {
    const products = JSON.parse(
      gallery.querySelector('[data-slot="lightbox-media"]')?.textContent ?? "[]",
    ) as LightboxMedia[]
    return (
      <Show when={open()}>
        {(current) => (
          <Lightbox
            product={products[current().product]}
            index={current().item}
            onIndex={(item) => setOpen({ ...current(), item })}
            onClose={() => {
              const from = current().from
              setOpen(undefined)
              from.focus()
            }}
          />
        )}
      </Show>
    )
  }, gallery)
  void mounted.then(() => setOpen(state))
}
