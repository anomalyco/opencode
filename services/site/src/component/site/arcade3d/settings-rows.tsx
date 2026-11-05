import { For, Show } from "solid-js"
import { SettingsSelect } from "../site"
import {
  controls,
  fps,
  type Group,
  qualities,
  resetTuning,
  setQualitySetting,
  setTuningValue,
  swatch,
  tuning,
} from "./tuning"

/**
 * The three.js version's rows in the Settings panel's "404 arcade" section: lights (each with a full
 * hue slider, saturation and intensity), the moonlight's direction and reach, dust, CRT, backdrop
 * grade, camera and quality. Loaded with the panel. Double-click a slider to reset it.
 */
export default function Arcade3DSettings() {
  return (
    <>
      <SettingsSelect label="Quality" options={qualities} value={tuning.quality} onChange={setQualitySetting} />
      <div data-slot="setting">
        <span>Frame rate</span>
        <output>{fps().toFixed(0)} fps</output>
      </div>
      <For each={Object.entries(controls) as [Group, (typeof controls)[Group]][]}>
        {([group, section]) => (
          <>
            <div data-slot="setting" data-kind="heading">
              <span style={{ color: "var(--text-strong)", "padding-top": "0.5rem" }}>{section.title}</span>
            </div>
            <For each={Object.entries(section.items)}>
              {([key, item]) => {
                const values = () => tuning[group] as Record<string, number>
                const value = () => values()[key]
                return (
                  <label data-slot="setting" data-kind="slider">
                    <span>
                      <Show when={key === "hue" && "saturation" in values()}>
                        <i
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: "0.7rem",
                            height: "0.7rem",
                            "margin-right": "0.35rem",
                            "vertical-align": "-0.05rem",
                            background: swatch(value(), values().saturation),
                            "box-shadow": "0 0 0 1px rgb(255 255 255 / 0.25)",
                          }}
                        />
                      </Show>
                      {item.label}
                    </span>
                    <input
                      type="range"
                      min={item.min}
                      max={item.max}
                      step={item.step}
                      value={value()}
                      style={
                        key === "hue"
                          ? {
                              "accent-color": swatch(value(), 1),
                              background:
                                "linear-gradient(to right, hsl(0 90% 60%), hsl(60 90% 60%), hsl(120 90% 60%), hsl(180 90% 60%), hsl(240 90% 60%), hsl(300 90% 60%), hsl(360 90% 60%))",
                              height: "0.4rem",
                              "border-radius": "999px",
                            }
                          : undefined
                      }
                      onInput={(event) => setTuningValue(group, key, Number(event.currentTarget.value))}
                      onDblClick={() => setTuningValue(group, key, item.value)}
                    />
                    <output>
                      {format(value(), item.step)}
                      {"unit" in item ? item.unit : ""}
                    </output>
                  </label>
                )
              }}
            </For>
          </>
        )}
      </For>
      <button type="button" data-slot="setting-reset" onClick={resetTuning}>
        Reset 3D scene
      </button>
    </>
  )
}

function format(value: number, step: number) {
  return value.toFixed(step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step))))
}
