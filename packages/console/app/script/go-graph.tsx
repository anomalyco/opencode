import { For, Show, createSignal } from "solid-js"
import { render } from "solid-js/web"
import { LimitsGraph } from "../src/component/limits-graph"
import { I18nProvider } from "../src/context/i18n"
import { LanguageProvider } from "../src/context/language"
import "@ibm/plex/css/ibm-plex.css"
import "../src/app.css"
import "../src/routes/go/index.css"

const options = [
  { name: "Critical", rate: 8 },
  { name: "Snappy", rate: 12 },
  { name: "Gentle", rate: 6 },
  { name: "Glide", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { name: "Sweep", easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
].map((option) => ({
  name: option.name,
  easing:
    option.easing ??
    `linear(${Array.from({ length: 31 }, (_, i) => {
      const t = i / 30
      const rate = option.rate!
      return (1 - (1 + rate * t) * Math.exp(-rate * t)) / (1 - (1 + rate) * Math.exp(-rate))
    }).join(",")})`,
}))

const controls = [
  { key: "bars", name: "Bars", min: 200, max: 2000, step: 50, unit: "ms" },
  { key: "lines", name: "Lines", min: 200, max: 3000, step: 50, unit: "ms" },
  { key: "bonus", name: "Bonus", min: 200, max: 2000, step: 50, unit: "ms" },
  { key: "heat", name: "Heat", min: 1, max: 3, step: 0.05, unit: "x" },
  { key: "cooling", name: "Cool down", min: 200, max: 4000, step: 100, unit: "ms" },
] as const

const digitEasings = [
  { name: "Matched spring", value: "var(--spring-easing)" },
  { name: "Even rotation", value: "linear" },
  { name: "Soft landing", value: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { name: "Smooth glide", value: "cubic-bezier(0.4, 0, 0.2, 1)" },
]

const gridEasings = [
  { name: "Soft landing", value: "cubic-bezier(0.22, 1, 0.36, 1)" },
  { name: "Critical spring", value: "var(--spring-easing)" },
  { name: "Gentle sweep", value: "cubic-bezier(0.45, 0, 0.55, 1)" },
  { name: "Smooth glide", value: "cubic-bezier(0.4, 0, 0.2, 1)" },
  { name: "Even draw", value: "linear" },
]

const saved = new URLSearchParams(sessionStorage.getItem("go-chart-preview") ?? "")
const digits = Number(saved.get("digits") ?? 2)
const [selection, setSelection] = createSignal({
  index: Number(saved.get("index")) || 0,
  bars: Number(saved.get("bars")) || 950,
  lines: Number(saved.get("lines")) || 2000,
  bonus: Number(saved.get("bonus")) || 1500,
  digits: digitEasings[digits] ? digits : 2,
  grid: Number(saved.get("grid") ?? 0),
  heat: Number(saved.get("heat")) || 1.15,
  cooling: Number(saved.get("cooling")) || 1600,
})

if (import.meta.hot) {
  const save = () =>
    sessionStorage.setItem(
      "go-chart-preview",
      new URLSearchParams(Object.entries(selection()).map(([key, value]) => [key, String(value)])).toString(),
    )
  import.meta.hot.on("vite:beforeUpdate", save)
  import.meta.hot.on("vite:beforeFullReload", save)
  import.meta.hot.on("vite:afterUpdate", () => setSelection((current) => ({ ...current })))
}

render(
  () => (
    <LanguageProvider>
      <I18nProvider>
        <main data-page="go">
          <style>{`
            body { margin: 0; }
            button { font: inherit; padding: 8px 12px; cursor: pointer; }
            #root button[aria-pressed="true"] { outline: 2px solid currentColor; outline-offset: 2px; }
            #root [data-component="limit-graph"] {
              --spring-easing: var(--preview-easing);
              --reveal-duration: var(--preview-bar-duration);
              --grid-duration: var(--preview-grid-duration);
              --grid-easing: var(--preview-grid-easing);
              --bonus-duration: var(--preview-bonus-duration);
              --digit-easing: var(--preview-digit-easing);
              --arrival-brightness: var(--preview-heat);
              --heat-duration: var(--preview-cooling);
            }
          `}</style>
          <header style="padding:24px;display:flex;flex-direction:column;gap:16px">
            <span>Go chart: base allowance, then bonus. Source edits hot-reload and replay automatically.</span>
            <div style="display:flex;flex-wrap:wrap;gap:12px">
              <For each={options}>
                {(option, i) => (
                  <button
                    aria-pressed={selection().index === i()}
                    onClick={() => setSelection((current) => ({ ...current, index: i() }))}
                  >
                    {option.name}
                  </button>
                )}
              </For>
              <button onClick={() => setSelection((current) => ({ ...current }))}>Replay animation</button>
              <button onClick={() => setSelection((current) => ({ ...current, bonus: 1500 }))}>
                Try latest timing
              </button>
              <label style="display:flex;align-items:center;gap:12px">
                Digits
                <select
                  value={selection().digits}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, digits: Number(event.currentTarget.value) }))
                  }
                >
                  <For each={digitEasings}>{(easing, i) => <option value={i()}>{easing.name}</option>}</For>
                </select>
              </label>
              <label style="display:flex;align-items:center;gap:12px">
                Grid easing
                <select
                  value={selection().grid}
                  onChange={(event) =>
                    setSelection((current) => ({ ...current, grid: Number(event.currentTarget.value) }))
                  }
                >
                  <For each={gridEasings}>{(easing, i) => <option value={i()}>{easing.name}</option>}</For>
                </select>
              </label>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:24px">
              <For each={controls}>
                {(control) => (
                  <label style="display:flex;align-items:center;gap:12px">
                    {control.name}: {selection()[control.key]}
                    {control.unit}
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      value={selection()[control.key]}
                      onChange={(event) =>
                        setSelection((current) => ({ ...current, [control.key]: Number(event.currentTarget.value) }))
                      }
                    />
                  </label>
                )}
              </For>
            </div>
          </header>
          <div data-component="container" style="width:100%">
            <div data-component="content">
              <Show when={selection()} keyed>
                {(current) => (
                  <section
                    data-component="comparison"
                    style={{
                      "--preview-easing": options[current.index].easing,
                      "--preview-bar-duration": `${current.bars}ms`,
                      "--preview-grid-duration": `${current.lines}ms`,
                      "--preview-grid-easing": gridEasings[current.grid].value,
                      "--preview-bonus-duration": `${current.bonus}ms`,
                      "--preview-digit-easing": digitEasings[current.digits].value,
                      "--preview-heat": current.heat,
                      "--preview-cooling": `${current.cooling}ms`,
                    }}
                  >
                    <LimitsGraph href="https://opencode.ai/docs/go/#usage-limits" />
                  </section>
                )}
              </Show>
            </div>
          </div>
        </main>
      </I18nProvider>
    </LanguageProvider>
  ),
  document.getElementById("root")!,
)
