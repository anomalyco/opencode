import { initWasm, Resvg } from "@resvg/resvg-wasm"
import satori, { init } from "satori/standalone"
import { height, ogCardElement, width, type OgCard } from "./card"

// Renders a card to PNG with Satori (layout and text to SVG paths) and resvg (SVG to PNG). Workers can't compile
// Wasm from bytes at runtime, so both engines take precompiled modules: the OG Worker imports them as Wasm modules
// (src/og/worker.ts) and local dev compiles them from node_modules (src/lib/resource.node.ts).
export type OgAssets = {
  layout: WebAssembly.Module
  resvg: WebAssembly.Module
  fonts: { name: string; data: ArrayBuffer; weight: 400 | 700 }[]
  // @opencode/ui's provider icon sprite.
  sprite: string
}

// Each engine initialises once per isolate.
let ready: Promise<unknown> | undefined

export async function renderOgPng(card: OgCard, assets: OgAssets) {
  ready ??= Promise.all([init(assets.layout), initWasm(assets.resvg)])
  await ready
  // Satori's types expect React elements; the card is the same shape as plain objects.
  const svg = await satori(ogCardElement(card, assets.sprite) as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: assets.fonts.map((font) => ({ ...font, style: "normal" as const })),
  })
  // Satori draws text as paths, so resvg needs no fonts.
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
  const image = resvg.render()
  // A copy on its own ArrayBuffer, which Response accepts as a body.
  const png = new Uint8Array(image.asPng())
  image.free()
  resvg.free()
  return png
}
