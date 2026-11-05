import { type JSX } from "solid-js"
import SettingsPanel from "../settings-panel"
import {
  arcadeCrts,
  arcadeLogoReveals,
  arcadeModes,
  arcadeNavBlends,
  setSiteSetting,
  siteSettings,
  siteSettingsDefaults,
} from "../settings"
import { SettingsSelect, SettingsSlider } from "../site"

/**
 * The site's Settings panel on the 404 arcade, with a "404 arcade" section first. Loaded the first
 * time Settings opens (it brings the panel and its styles). `rows` adds version-specific controls
 * (the image version's are below; the three.js version passes its own).
 */
export default function ArcadeSettingsPanel(props: { onClose: () => void; rows?: () => JSX.Element }) {
  return (
    <SettingsPanel
      onClose={props.onClose}
      settings={(section) =>
        section === "arcade" ? (
          <>
            <SettingsSelect
              label="Mode"
              options={arcadeModes}
              value={siteSettings.arcadeMode}
              onChange={(value) => {
                setSiteSetting("arcadeMode", value)
                // Bad URLs and /dev/404 follow the setting; the 3D preview only shows 3D.
                if (location.pathname.endsWith("/dev/404-3d") && value !== "3D")
                  location.assign(location.pathname.replace(/\/dev\/404-3d$/, "/dev/404"))
              }}
            />
            <SettingsSlider
              label="Saturation"
              unit="%"
              min={0}
              max={100}
              step={5}
              value={siteSettings.arcadeSaturation}
              onInput={(value) => setSiteSetting("arcadeSaturation", value)}
            />
            <SettingsSlider
              label="White balance (cool − / warm +)"
              unit=""
              min={-100}
              max={100}
              step={5}
              value={siteSettings.arcadeWhiteBalance}
              onInput={(value) => setSiteSetting("arcadeWhiteBalance", value)}
            />
            <SettingsSlider
              label="Volume"
              unit="%"
              min={0}
              max={100}
              step={5}
              value={siteSettings.arcadeVolume}
              onInput={(value) => setSiteSetting("arcadeVolume", value)}
            />
            <SettingsSlider
              label="Ambience"
              unit="%"
              min={0}
              max={100}
              step={5}
              value={siteSettings.arcadeAmbience}
              onInput={(value) => setSiteSetting("arcadeAmbience", value)}
            />
            <SettingsSlider
              label="Sound effects"
              unit="%"
              min={0}
              max={100}
              step={5}
              value={siteSettings.arcadeSfx}
              onInput={(value) => setSiteSetting("arcadeSfx", value)}
            />
            <SettingsSelect
              label="CRT"
              options={arcadeCrts}
              value={siteSettings.arcadeCrt}
              onChange={(value) => setSiteSetting("arcadeCrt", value)}
            />
            <SettingsSelect
              label="Title › Logo reveal"
              options={arcadeLogoReveals}
              value={siteSettings.arcadeLogoReveal}
              onChange={(value) => setSiteSetting("arcadeLogoReveal", value)}
            />
            <SettingsSelect
              label="Nav blend"
              options={arcadeNavBlends}
              value={siteSettings.arcadeNavBlend}
              onChange={(value) => setSiteSetting("arcadeNavBlend", value)}
            />
            <SettingsSlider
              label="Nav shade"
              unit="%"
              min={0}
              max={100}
              step={5}
              value={siteSettings.arcadeShade}
              onInput={(value) => setSiteSetting("arcadeShade", value)}
            />
            {props.rows?.()}
            <button type="button" data-slot="setting-reset" onClick={resetArcadeSettings}>
              Reset 404 arcade
            </button>
          </>
        ) : undefined
      }
      theme="dark"
      onTheme={() => {}}
      onFooter={() => {}}
    />
  )
}

/** Every `arcade*` setting back to its default (the rest of the site's settings stay). */
export function resetArcadeSettings() {
  for (const name of Object.keys(siteSettingsDefaults) as (keyof typeof siteSettingsDefaults)[]) {
    if (name.startsWith("arcade")) setSiteSetting(name, siteSettingsDefaults[name] as never)
  }
}

/** The image version's rows. */
export function ImageArcadeSettings() {
  const slider = (
    label: string,
    name:
      | "arcadeCoinSize"
      | "arcadeGlisten"
      | "arcadeGlistenRate"
      | "arcadeCameraSpeed"
      | "arcadeDoorZoom"
      | "arcadeScanlines"
      | "arcadeFlicker"
      | "arcadeGlitch"
      | "arcadeBoot"
      | "arcadeStartDelay",
    unit: string,
    min: number,
    max: number,
    step: number,
  ) => (
    <SettingsSlider
      label={label}
      unit={unit}
      min={min}
      max={max}
      step={step}
      value={siteSettings[name]}
      onInput={(value) => setSiteSetting(name, value)}
    />
  )
  return (
    <>
      {slider("Coin size", "arcadeCoinSize", "×", 0.5, 3, 0.1)}
      {slider("Glisten", "arcadeGlisten", "%", 0, 100, 5)}
      {slider("Glisten every", "arcadeGlistenRate", "s", 1, 8, 0.2)}
      {slider("Camera speed", "arcadeCameraSpeed", "×", 0.5, 2, 0.1)}
      {slider("Door zoom", "arcadeDoorZoom", "×", 0.6, 1.6, 0.05)}
      {slider("Scanlines", "arcadeScanlines", "%", 0, 100, 5)}
      {slider("Flicker", "arcadeFlicker", "%", 0, 100, 5)}
      {slider("Glitch", "arcadeGlitch", "ms", 300, 2000, 50)}
      {slider("Boot", "arcadeBoot", "ms", 2000, 8000, 100)}
      {slider("Start auto-advance (0 off)", "arcadeStartDelay", "ms", 0, 10000, 100)}
    </>
  )
}
