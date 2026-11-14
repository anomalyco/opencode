// The image preview over the prompt's Kitty thumbnail, on a terminal that shows Kitty graphics with 20x40-pixel cells.
// In the preview a 1600x1200 noise image is no smaller than its source, so its upload is larger than one frame's
// output. TS sends it with Kitty across frames; Rust, since anomalyco/opentui#2135, sends one copy that fits a frame.
// Both show it with Kitty, so the open preview compares, and closing it leaves no block glyph over the thumbnail
// (anomalyco/opentui#2130, which cleared the half blocks Rust drew there before #2135).
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"
import { definePty } from "../../pty/run"
import { homeMasks, paste, press, release } from "./home"

const png = path.join(tmpdir(), "opencode-parity-kitty-preview.png")
const config = { experimental: { "new-designs": true }, debug: { devtools: false }, prompt: { image_preview: true } }
// Block glyphs other than the logo's (`█▀▄`).
const quadrants = /[▖▗▘▙▚▛▜▝▞▟▌▐]/

export default definePty({
  args: [],
  cols: 120,
  rows: 40,
  env: { OPENCODE_CLI_CONFIG_CONTENT: JSON.stringify(config) },
  server: { fallback: "tui" },
  graphics: { cell: 20 },
  setup: async () => {
    await Bun.write(png, noise(1600, 1200))
  },
  steps: [
    { until: { screen: "█▀▀█" }, settle: 500, timeout: 30_000 },
    { keys: paste(png), until: { screen: "[Image 1]" }, settle: 1500, checkpoint: "thumbnail" },
    // The thumbnail sits above `[Image 1]`, at the prompt's left.
    {
      keys: press(30, 22) + release(30, 22),
      until: { screen: "Image 1 of 1" },
      settle: 1500,
      timeout: 20_000,
      checkpoint: "preview",
    },
    { keys: "\x1b", until: { screen: "[Image 1]" }, settle: 1500, absent: "Image 1 of 1", checkpoint: "closed" },
  ],
  masks: homeMasks,
  // The thumbnail is Kitty's, so the prompt's rows above `[Image 1]` hold no block glyph.
  verify: ({ screen }) => {
    const label = screen.findIndex((line) => line.includes("[Image 1]"))
    const left = screen
      .slice(0, label)
      .flatMap((line, row) => (line.trimStart().startsWith("┃") && quadrants.test(line) ? [`${row}: ${line}`] : []))
    return left.length ? [`block glyphs left over the thumbnail:\n${left.join("\n")}`] : []
  },
})

// An RGB PNG of seeded noise, which no compression shrinks.
function noise(width: number, height: number) {
  const raw = new Uint8Array((width * 3 + 1) * height)
  // xorshift32: a linear congruential generator's bytes compress.
  let state = 2463534242
  for (let at = 0; at < raw.length; at++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    raw[at] = at % (width * 3 + 1) === 0 ? 0 : state & 255
  }
  const chunk = (kind: string, data: Uint8Array) => {
    const out = new Uint8Array(data.length + 12)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    out.set(new TextEncoder().encode(kind), 4)
    out.set(data, 8)
    view.setUint32(data.length + 8, Bun.hash.crc32(out.subarray(4, data.length + 8)))
    return out
  }
  const header = new DataView(new ArrayBuffer(13))
  header.setUint32(0, width)
  header.setUint32(4, height)
  new Uint8Array(header.buffer).set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", new Uint8Array(header.buffer)),
    chunk("IDAT", deflateSync(raw, { level: 1 })),
    chunk("IEND", new Uint8Array()),
  ])
}
