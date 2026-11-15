import { onCleanup, onMount } from "solid-js"
import { mountGoUpsellHero } from "./go-upsell-hero-art"

export function GoUpsellHero() {
  let canvas!: HTMLCanvasElement
  onMount(() => onCleanup(mountGoUpsellHero(canvas)))

  return (
    <div class="relative -mb-6 h-[176px] w-full shrink-0" aria-hidden="true">
      <canvas
        ref={canvas}
        data-slot="go-upsell-hero"
        class="absolute inset-0 block size-full [mask-image:linear-gradient(to_bottom,#000_58%,transparent_100%)]"
      />
    </div>
  )
}
