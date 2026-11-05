import { createSignal, For } from "solid-js"
import { SettingsSlider } from "../site"
import { layerControls, layerValues, layerValuesJson, resetLayerValues, setLayerValue } from "./layers-tuning"

type Group = keyof typeof layerControls

/**
 * The layers mode's rows in the Settings panel's "404 arcade" section (404 arcade › Layers): the
 * moon beam, floor light, dust and grade, applied live while dragging and saved in localStorage
 * (layers-tuning.ts). Reset returns to the tuned defaults; Copy values puts them on the clipboard
 * as JSON, ready to bake in as new defaults. Shown only while the 404 is in layers mode.
 */
export default function LayersSettings() {
  const [copied, setCopied] = createSignal(false)
  const copy = () =>
    void navigator.clipboard?.writeText(layerValuesJson()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  return (
    <>
      <div data-slot="setting" data-kind="heading">
        <span style={{ color: "var(--text-strong)", "padding-top": "0.5rem" }}>Layers</span>
      </div>
      <For each={Object.entries(layerControls) as [Group, (typeof layerControls)[Group]][]}>
        {([group, section]) => (
          <For each={Object.entries(section.items)}>
            {([key, item]) => (
              <SettingsSlider
                label={`${section.title} · ${item.label}`}
                unit={("unit" in item ? item.unit : undefined) ?? ""}
                min={item.min}
                max={item.max}
                step={item.step}
                value={(layerValues[group] as Record<string, number>)[key]}
                onInput={(value) => setLayerValue(group, key, value)}
              />
            )}
          </For>
        )}
      </For>
      <button type="button" data-slot="setting-reset" onClick={resetLayerValues}>
        Reset layers
      </button>
      <button type="button" data-slot="setting-reset" onClick={copy}>
        {copied() ? "Copied" : "Copy layer values"}
      </button>
    </>
  )
}
