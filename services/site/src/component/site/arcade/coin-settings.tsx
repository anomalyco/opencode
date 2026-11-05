import { createSignal, For } from "solid-js"
import { SettingsSlider } from "../site"
import {
  coinControls,
  coinPreview,
  coinReplay,
  coinValues,
  coinValuesJson,
  resetCoinValues,
  setCoinPreview,
  setCoinReplay,
  setCoinValue,
  type CoinGroup,
} from "./coin-tuning"

/**
 * Settings › 404 arcade › Coin: the token's held and insert poses and the fade timings
 * (coin-tuning.ts), applied live. Preview holds the token still over the cabinet in its held pose;
 * Replay insert plays the slide into the slot again.
 */
export default function CoinSettings() {
  const [copied, setCopied] = createSignal(false)
  const copy = () =>
    void navigator.clipboard?.writeText(coinValuesJson()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  return (
    <>
      <div data-slot="setting" data-kind="heading">
        <span style={{ color: "var(--text-strong)", "padding-top": "0.5rem" }}>Coin</span>
      </div>
      <button
        type="button"
        data-slot="setting-reset"
        aria-pressed={coinPreview()}
        onClick={() => setCoinPreview(!coinPreview())}
      >
        {coinPreview() ? "Preview on (held over the cabinet)" : "Preview off"}
      </button>
      <button type="button" data-slot="setting-reset" onClick={() => setCoinReplay(coinReplay() + 1)}>
        Replay insert
      </button>
      <For each={Object.entries(coinControls) as [CoinGroup, (typeof coinControls)[CoinGroup]][]}>
        {([group, section]) => (
          <For each={Object.entries(section.items)}>
            {([key, item]) => (
              <SettingsSlider
                label={`${section.title} · ${item.label}`}
                unit={item.unit}
                min={item.min}
                max={item.max}
                step={item.step}
                value={(coinValues[group] as Record<string, number>)[key]}
                onInput={(value) => setCoinValue(group, key, value)}
              />
            )}
          </For>
        )}
      </For>
      <button type="button" data-slot="setting-reset" onClick={resetCoinValues}>
        Reset coin
      </button>
      <button type="button" data-slot="setting-reset" onClick={copy}>
        {copied() ? "Copied" : "Copy coin values"}
      </button>
    </>
  )
}
