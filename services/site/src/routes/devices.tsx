import { Meta, Title } from "@solidjs/meta"
import { createSignal, For } from "solid-js"

// Development tool: the site at common device sizes, side by side or one at a time.
const devices = [
  { name: "iPhone SE", width: 375, height: 667 },
  { name: "iPhone 16", width: 393, height: 852 },
  { name: "iPhone 16 Pro Max", width: 440, height: 956 },
  { name: "Pixel 9", width: 412, height: 915 },
  { name: "iPad mini", width: 744, height: 1133 },
  { name: "iPad Air", width: 820, height: 1180 },
  { name: "iPad Pro 13", width: 1032, height: 1376 },
  { name: "Laptop", width: 1280, height: 800 },
  { name: "MacBook Air 13", width: 1440, height: 900 },
  { name: "MacBook Pro 16", width: 1728, height: 1117 },
]

const pages = [
  "/",
  "/desktop",
  "/mobile",
  "/terminal",
  "/sdk",
  "/product",
  "/docs",
  "/changelog",
  "/brand",
  "/press",
  "/legal",
]

export default function Devices() {
  const [path, setPath] = createSignal("/")
  const [selected, setSelected] = createSignal<string>("all phones")
  const [scale, setScale] = createSignal(0.6)
  const [key, setKey] = createSignal(0)

  const shown = () => {
    if (selected() === "all phones") return devices.filter((device) => device.width < 500)
    if (selected() === "all tablets") return devices.filter((device) => device.width >= 500 && device.width < 1200)
    if (selected() === "all") return devices
    return devices.filter((device) => device.name === selected())
  }

  return (
    <main
      style={{
        "min-height": "100vh",
        background: "#0e0e0e",
        color: "#ddd",
        "font-family": "ui-monospace, monospace",
        "font-size": "12px",
        padding: "16px",
      }}
    >
      <Title>Device preview</Title>
      <Meta name="robots" content="noindex" />
      <div
        style={{ display: "flex", gap: "12px", "flex-wrap": "wrap", "align-items": "center", "margin-bottom": "16px" }}
      >
        <label>
          Page{" "}
          <select value={path()} onChange={(event) => setPath(event.currentTarget.value)}>
            <For each={pages}>{(page) => <option value={page}>{page}</option>}</For>
          </select>
        </label>
        <input
          value={path()}
          onChange={(event) => setPath(event.currentTarget.value)}
          style={{ width: "200px", background: "#1a1a1a", color: "#ddd", border: "1px solid #333", padding: "4px 6px" }}
        />
        <label>
          Device{" "}
          <select value={selected()} onChange={(event) => setSelected(event.currentTarget.value)}>
            <option value="all phones">All phones</option>
            <option value="all tablets">All tablets</option>
            <option value="all">All</option>
            <For each={devices}>
              {(device) => (
                <option value={device.name}>
                  {device.name} ({device.width}×{device.height})
                </option>
              )}
            </For>
          </select>
        </label>
        <label>
          Scale{" "}
          <input
            type="range"
            min="0.25"
            max="1"
            step="0.05"
            value={scale()}
            onInput={(event) => setScale(Number(event.currentTarget.value))}
          />{" "}
          {Math.round(scale() * 100)}%
        </label>
        <button
          type="button"
          onClick={() => setKey(key() + 1)}
          style={{ background: "#1a1a1a", color: "#ddd", border: "1px solid #333", padding: "4px 10px" }}
        >
          Reload all
        </button>
      </div>
      <div style={{ display: "flex", gap: "24px", "flex-wrap": "wrap", "align-items": "flex-start" }}>
        <For each={shown()}>
          {(device) => (
            <figure style={{ margin: 0 }}>
              <figcaption style={{ "margin-bottom": "6px", color: "#888" }}>
                {device.name} · {device.width}×{device.height}
              </figcaption>
              <div
                style={{
                  width: `${device.width * scale()}px`,
                  height: `${device.height * scale()}px`,
                  overflow: "hidden",
                  outline: "1px solid #333",
                }}
              >
                <iframe
                  data-key={key()}
                  src={`${path()}${path().includes("?") ? "&" : "?"}r=${key()}`}
                  title={device.name}
                  style={{
                    width: `${device.width}px`,
                    height: `${device.height}px`,
                    border: 0,
                    transform: `scale(${scale()})`,
                    "transform-origin": "top left",
                    background: "#fff",
                  }}
                />
              </div>
            </figure>
          )}
        </For>
      </div>
    </main>
  )
}
