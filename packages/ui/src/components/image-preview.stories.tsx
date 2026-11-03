// @ts-nocheck
import { onMount } from "solid-js"
import * as mod from "./image-preview"
import { Button } from "@opencode/ui/button"
import { useDialog } from "../context/dialog"

const docs = `### Overview
Image preview content intended to render inside the dialog stack.

Use for full-size image inspection; keep images optimized.

### API
- Required: \`src\`.
- Optional: \`alt\` text, \`origin\`, the image on the page that the preview grows out of and shrinks back into, and
  \`video\`, a video on the page that the preview borrows and shows instead, still playing.

### Variants and states
- Single layout: the image fills the window without a panel, with zoom controls and a close action in one strip under it.

### Behavior
- Intended to be used via \`useDialog().show\`.
- With an \`origin\`, the image flies from its place on the page to the preview while the page dims, and back on close.
- Pinch or Cmd/Ctrl + wheel zooms at the cursor; wheel and drag pan while zoomed.
- Double-click toggles between fit and 100%; Cmd/Ctrl + =, - and 0 zoom in, out and to fit, as do 0 and a first Escape.
- A video zooms inside its own frame, under its controls; Space plays and pauses it.
- A click on the backdrop around the image closes it, unless it ends a pan.

### Accessibility
- Uses localized aria-label for close button.

### Theming/tokens
- Uses \`data-component="image-preview"\` and slot attributes.

`

export default {
  title: "UI/ImagePreview",
  id: "components-image-preview",
  component: mod.ImagePreview,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component: docs,
      },
    },
  },
}

export const Basic = {
  render: () => {
    const dialog = useDialog()
    const src = "https://placehold.co/640x360/png"

    const open = () => dialog.show(() => <mod.ImagePreview src={src} alt="Preview" />)

    onMount(open)

    return (
      <Button variant="neutral" onClick={open}>
        Open image preview
      </Button>
    )
  },
}

// A large, offline, screenshot-style bitmap with small text that is only legible once zoomed in.
export const Screenshot = {
  render: () => {
    const dialog = useDialog()
    const src = screenshot()

    const open = () => dialog.show(() => <mod.ImagePreview src={src} alt="Editor screenshot" />)

    onMount(open)

    return (
      <Button variant="neutral" onClick={open}>
        Open screenshot preview
      </Button>
    )
  },
}

// Images in a message open from where they sit and close back into place: a full-width image and a cropped thumbnail.
export const FromMessage = {
  render: () => {
    const dialog = useDialog()
    const src = poster()

    const open = (event: MouseEvent & { currentTarget: HTMLImageElement }) => {
      const origin = event.currentTarget
      dialog.show(() => <mod.ImagePreview src={src} alt={origin.alt} origin={origin} />)
    }

    return (
      <div style={{ width: "640px", margin: "48px auto", display: "flex", "flex-direction": "column", gap: "16px" }}>
        <div style={{ display: "flex", "justify-content": "flex-end" }}>
          <img
            data-story-image="thumbnail"
            src={src}
            alt="Poster thumbnail"
            onClick={open}
            style={{ width: "58px", height: "46px", "object-fit": "cover", "border-radius": "6px", cursor: "pointer" }}
          />
        </div>
        <p>Here is the poster for the garden open day, with the new colours.</p>
        <img
          data-story-image="inline"
          src={src}
          alt="Garden open day poster"
          onClick={open}
          style={{ width: "100%", "border-radius": "8px", cursor: "zoom-in" }}
        />
        <p>The hills use the brand greens, and the date sits on the sun.</p>
      </div>
    )
  },
}

// A video in a pane opens into the preview still playing, and goes back when it closes.
export const FromVideo = {
  render: () => {
    const dialog = useDialog()
    let video

    onMount(() => {
      const canvas = document.createElement("canvas")
      canvas.width = 640
      canvas.height = 400
      const ctx = canvas.getContext("2d")

      const draw = (time) => {
        ctx.fillStyle = "#1f2a44"
        ctx.fillRect(0, 0, 640, 400)
        ctx.fillStyle = "#ffd27a"
        ctx.beginPath()
        ctx.arc(320 + 200 * Math.sin(time / 700), 200, 60, 0, Math.PI * 2)
        ctx.fill()
        requestAnimationFrame(draw)
      }

      requestAnimationFrame(draw)
      video.srcObject = canvas.captureStream(30)
    })

    const open = () => dialog.show(() => <mod.ImagePreview src="" alt="Orchard board tour" video={video} />)

    return (
      <div
        data-story-pane
        style={{ width: "640px", margin: "48px auto", display: "flex", "justify-content": "center" }}
      >
        <video
          ref={video}
          data-story-video
          muted
          autoplay
          playsinline
          controls
          onDblClick={open}
          style={{ width: "100%", "border-radius": "8px", background: "black" }}
        />
      </div>
    )
  },
}

// A bright, offline poster, so the image reads clearly against the dimmed page while it moves.
function poster() {
  const canvas = document.createElement("canvas")
  canvas.width = 1600
  canvas.height = 1000
  const ctx = canvas.getContext("2d")
  const sky = ctx.createLinearGradient(0, 0, 0, 1000)
  sky.addColorStop(0, "#ff8a5b")
  sky.addColorStop(1, "#ffd27a")
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 1600, 1000)
  ctx.fillStyle = "#fff4d6"
  ctx.beginPath()
  ctx.arc(1120, 360, 170, 0, Math.PI * 2)
  ctx.fill()
  ;[
    ["#3f9d5a", 700, 0.0],
    ["#2f7d48", 790, 1.7],
    ["#1f5c36", 880, 3.1],
  ].forEach(([color, base, phase]) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(0, 1000)

    for (let x = 0; x <= 1600; x += 20) ctx.lineTo(x, base - 70 * Math.sin(x / 260 + phase))
    ctx.lineTo(1600, 1000)
    ctx.fill()
  })
  ctx.fillStyle = "#1f2a44"
  ctx.font = "800 120px -apple-system, system-ui, sans-serif"
  ctx.fillText("Garden open day", 110, 230)
  ctx.font = "600 52px -apple-system, system-ui, sans-serif"
  ctx.fillText("Lumen Garden · 12 April", 116, 310)
  ctx.fillStyle = "#c2410c"
  ctx.font = "800 64px -apple-system, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.fillText("12.4", 1120, 382)

  return canvas.toDataURL("image/png")
}

function screenshot() {
  const canvas = document.createElement("canvas")
  canvas.width = 2880
  canvas.height = 1800
  const ctx = canvas.getContext("2d")
  ctx.scale(2, 2)

  ctx.fillStyle = "#1d1e22"
  ctx.fillRect(0, 0, 1440, 900)
  ctx.fillStyle = "#2a2b31"
  ctx.fillRect(0, 0, 1440, 38)
  ;["#ff5f57", "#febc2e", "#28c840"].forEach((color, index) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(20 + index * 20, 19, 6, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.fillStyle = "#a9abb3"
  ctx.font = "13px -apple-system, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.fillText("orchard.ts — lumen-garden", 720, 24)
  ctx.textAlign = "left"

  ctx.fillStyle = "#23242a"
  ctx.fillRect(0, 38, 240, 836)
  ctx.fillStyle = "#7d808a"
  ctx.font = "600 10px -apple-system, system-ui, sans-serif"
  ctx.fillText("EXPLORER", 16, 64)
  ;[
    "src",
    "  orchard.ts",
    "  greenhouse.ts",
    "  sprinkler.ts",
    "  seeds",
    "    tomato.json",
    "    basil.json",
    "    marigold.json",
    "test",
    "  orchard.test.ts",
    "README.md",
    "package.json",
  ].forEach((name, index) => {
    if (index === 1) {
      ctx.fillStyle = "#33353d"
      ctx.fillRect(0, 76 + index * 24, 240, 24)
    }

    ctx.fillStyle = index === 1 ? "#e6e7eb" : "#a9abb3"
    ctx.font = "12px -apple-system, system-ui, sans-serif"
    ctx.fillText(name.trimStart(), 20 + (name.length - name.trimStart().length) * 6, 92 + index * 24)
  })

  const code = [
    [
      ["#c792ea", "import "],
      ["#e6e7eb", "{ Sprinkler } "],
      ["#c792ea", "from "],
      ["#c3e88d", '"./sprinkler"'],
    ],
    [
      ["#c792ea", "import "],
      ["#e6e7eb", "{ Greenhouse } "],
      ["#c792ea", "from "],
      ["#c3e88d", '"./greenhouse"'],
    ],
    [],
    [["#5c6370", "// Waters each bed once the soil sensor drops below its threshold."]],
    [
      ["#c792ea", "export function "],
      ["#82aaff", "tend"],
      ["#e6e7eb", "(garden: Greenhouse, now: Date) {"],
    ],
    [
      ["#c792ea", "  const "],
      ["#e6e7eb", "dry = garden.beds."],
      ["#82aaff", "filter"],
      ["#e6e7eb", "((bed) => bed.moisture < bed.threshold)"],
    ],
    [
      ["#c792ea", "  if "],
      ["#e6e7eb", "(dry.length === "],
      ["#f78c6c", "0"],
      ["#e6e7eb", ") "],
      ["#c792ea", "return"],
    ],
    [],
    [
      ["#c792ea", "  for "],
      ["#e6e7eb", "("],
      ["#c792ea", "const "],
      ["#e6e7eb", "bed "],
      ["#c792ea", "of "],
      ["#e6e7eb", "dry) {"],
    ],
    [
      ["#c792ea", "    const "],
      ["#e6e7eb", "minutes = Math."],
      ["#82aaff", "ceil"],
      ["#e6e7eb", "((bed.threshold - bed.moisture) * "],
      ["#f78c6c", "4"],
      ["#e6e7eb", ")"],
    ],
    [
      ["#e6e7eb", "    Sprinkler."],
      ["#82aaff", "open"],
      ["#e6e7eb", "(bed.valve, { minutes, startedAt: now })"],
    ],
    [
      ["#e6e7eb", "    garden.log."],
      ["#82aaff", "push"],
      ["#e6e7eb", "(`watered ${bed.name} for ${minutes}m`)"],
    ],
    [["#e6e7eb", "  }"]],
    [],
    [
      ["#c792ea", "  return "],
      ["#e6e7eb", "dry."],
      ["#82aaff", "map"],
      ["#e6e7eb", "((bed) => bed.name)"],
    ],
    [["#e6e7eb", "}"]],
  ]

  ctx.font = "13px Menlo, ui-monospace, monospace"
  code.forEach((line, index) => {
    const y = 76 + index * 22
    ctx.fillStyle = "#4b4e57"
    ctx.textAlign = "right"
    ctx.fillText(String(index + 1), 296, y)
    ctx.textAlign = "left"
    line.reduce((x, [color, text]) => {
      ctx.fillStyle = color
      ctx.fillText(text, x, y)

      return x + ctx.measureText(text).width
    }, 320)
  })

  ctx.fillStyle = "#26272d"
  ctx.fillRect(1080, 38, 360, 836)
  ctx.fillStyle = "#e6e7eb"
  ctx.font = "600 12px -apple-system, system-ui, sans-serif"
  ctx.fillText("Soil moisture", 1100, 70)
  ;[0.62, 0.31, 0.48, 0.27, 0.71, 0.55].forEach((value, index) => {
    const y = 92 + index * 34
    ctx.fillStyle = "#a9abb3"
    ctx.font = "11px -apple-system, system-ui, sans-serif"
    ctx.fillText(`Bed ${String.fromCharCode(65 + index)}`, 1100, y + 12)
    ctx.fillStyle = "#33353d"
    ctx.fillRect(1160, y + 3, 220, 10)
    ctx.fillStyle = value < 0.35 ? "#f78c6c" : "#7fd88f"
    ctx.fillRect(1160, y + 3, 220 * value, 10)
    ctx.fillStyle = "#7d808a"
    ctx.font = "8px -apple-system, system-ui, sans-serif"
    ctx.fillText(`${Math.round(value * 100)}% · threshold 35%`, 1386 - 64, y + 26)
  })
  ctx.fillStyle = "#7d808a"
  ctx.font = "7px -apple-system, system-ui, sans-serif"
  ;[
    "Sensor readings refresh every 90 seconds.",
    "Beds below their threshold are watered on the next tick.",
    "Valve 4 was serviced on 12 March; calibration offset +0.02.",
  ].forEach((text, index) => ctx.fillText(text, 1100, 330 + index * 11))

  ctx.fillStyle = "#3b5bdb"
  ctx.fillRect(0, 874, 1440, 26)
  ctx.fillStyle = "#ffffff"
  ctx.font = "11px -apple-system, system-ui, sans-serif"
  ctx.fillText("main  ·  0 problems  ·  Ln 6, Col 42  ·  UTF-8  ·  TypeScript", 12, 891)

  return canvas.toDataURL("image/png")
}
