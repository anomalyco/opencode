// The stand-in for resource.cloudflare.ts under `vite dev` and tests: cards render in-process from node_modules and
// the source fonts, there is no edge cache, and waitUntil just awaits.
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import type { OgCard } from "../og/card"
import type { OgAssets } from "../og/render-png"

const resolve = createRequire(import.meta.url).resolve
let assets: Promise<OgAssets> | undefined

export async function renderOgCard(card: OgCard) {
  const { renderOgPng } = await import("../og/render-png")
  assets ??= loadAssets()
  return renderOgPng(card, await assets)
}

export async function bannerPng() {
  return new Uint8Array(await readFile(new URL("../../public/banner.png", import.meta.url)))
}

export function edgeCache(): Cache | undefined {
  return undefined
}

export const waitUntil = async (promise: Promise<unknown>) => {
  await promise
}

async function loadAssets(): Promise<OgAssets> {
  const { decompress } = await import("wawoff2")
  const font = async (weight: "regular" | "bold", group: "latin" | "rest") => {
    const bytes = await decompress(
      await readFile(new URL(`../asset/fonts/opentui-mono-${weight}-${group}.woff2`, import.meta.url)),
    )
    return {
      name: "OpenTUI Mono",
      data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      weight: weight === "bold" ? (700 as const) : (400 as const),
    }
  }
  return {
    layout: await WebAssembly.compile(await readFile(resolve("satori/layout.wasm"))),
    resvg: await WebAssembly.compile(await readFile(resolve("@resvg/resvg-wasm/index_bg.wasm"))),
    fonts: await Promise.all([
      font("regular", "latin"),
      font("regular", "rest"),
      font("bold", "latin"),
      font("bold", "rest"),
    ]),
    sprite: await readFile(new URL("../../../../ui/src/components/provider-icons/sprite.svg", import.meta.url), "utf8"),
  }
}
