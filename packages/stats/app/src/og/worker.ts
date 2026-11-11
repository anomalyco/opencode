// The private OG Worker (services/data/og.config.ts). The data Worker posts a card to it over a Service Binding and gets a
// PNG back. It is its own Worker so the data Worker doesn't load its Wasm engines and fonts.
// script/build-og-worker.ts bundles it and writes the modules imported here next to it.
import regularLatin from "./opentui-mono-regular-latin.bin"
import regularRest from "./opentui-mono-regular-rest.bin"
import boldLatin from "./opentui-mono-bold-latin.bin"
import boldRest from "./opentui-mono-bold-rest.bin"
import harfbuzz from "./harfbuzz.wasm"
import resvg from "./resvg.wasm"
import layout from "./satori-layout.wasm"
import sprite from "../../../../ui/src/components/provider-icons/sprite.svg"
import type { OgCard } from "./card"
import { renderOgPng } from "./render-png"

// Satori shapes text with HarfBuzz, whose Wasm it inlines as bytes and compiles at runtime, which Workers forbid. The
// build writes those same bytes out as harfbuzz.wasm, which Cloudflare compiles at upload, and this hands that module
// to the one instantiate call that passes bytes.
const instantiate = WebAssembly.instantiate.bind(WebAssembly)
WebAssembly.instantiate = ((source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) =>
  source instanceof WebAssembly.Module
    ? instantiate(source, imports)
    : instantiate(harfbuzz, imports).then((instance) => ({
        module: harfbuzz,
        instance,
      }))) as typeof WebAssembly.instantiate

const fonts = [
  { name: "OpenTUI Mono", data: regularLatin, weight: 400 as const },
  { name: "OpenTUI Mono", data: regularRest, weight: 400 as const },
  { name: "OpenTUI Mono", data: boldLatin, weight: 700 as const },
  { name: "OpenTUI Mono", data: boldRest, weight: 700 as const },
]

export default {
  async fetch(request: Request) {
    const card = (await request.json()) as OgCard
    const png = await renderOgPng(card, { layout, resvg, fonts, sprite })
    return new Response(png, { headers: { "Content-Type": "image/png" } })
  },
}
