import { Match, Switch } from "solid-js"
import { replayLogos } from "./logo-wall"
import { logoEasings, setLogoTuning, setSiteSetting, siteSettings, toggles } from "./settings"
import { SettingsSelect, SettingsSlider } from "./site"

/** The selected logo animation's own controls, the swap interval and a Replay button. */
export function LogoAnimationSettings() {
  const tuning = () => siteSettings.logoTuning
  const style = () => siteSettings.logoAnimation

  return (
    <>
      <SettingsSlider
        label="Duration"
        unit="ms"
        min={80}
        max={1500}
        step={10}
        value={tuning()[style()].duration}
        onInput={(value) => setLogoTuning(style(), "duration", value)}
      />
      <SettingsSlider
        label="Delay"
        unit="ms"
        min={0}
        max={1000}
        step={10}
        value={tuning()[style()].delay}
        onInput={(value) => setLogoTuning(style(), "delay", value)}
      />
      <Switch>
        <Match when={style() === "fade"}>
          <Easing style="fade" />
        </Match>
        <Match when={style() === "blur"}>
          <Easing style="blur" />
          <SettingsSlider
            label="Blur"
            unit="px"
            min={0}
            max={16}
            step={1}
            value={tuning().blur.blur}
            onInput={(value) => setLogoTuning("blur", "blur", value)}
          />
        </Match>
        <Match when={style() === "rise"}>
          <Easing style="rise" />
          <SettingsSlider
            label="Rise"
            unit="px"
            min={0}
            max={32}
            step={1}
            value={tuning().rise.rise}
            onInput={(value) => setLogoTuning("rise", "rise", value)}
          />
          <SettingsSlider
            label="Blur"
            unit="px"
            min={0}
            max={16}
            step={1}
            value={tuning().rise.blur}
            onInput={(value) => setLogoTuning("rise", "blur", value)}
          />
        </Match>
        <Match when={style() === "scale"}>
          <Easing style="scale" />
          <SettingsSlider
            label="Scale from"
            unit="%"
            min={50}
            max={100}
            step={1}
            value={tuning().scale.scale}
            onInput={(value) => setLogoTuning("scale", "scale", value)}
          />
        </Match>
        <Match when={style() === "flip"}>
          <Easing style="flip" />
          <SettingsSlider
            label="Perspective"
            unit="px"
            min={100}
            max={1200}
            step={10}
            value={tuning().flip.perspective}
            onInput={(value) => setLogoTuning("flip", "perspective", value)}
          />
          <SettingsSelect
            label="Axis"
            options={["x", "y"] as const}
            value={tuning().flip.axis}
            onChange={(value) => setLogoTuning("flip", "axis", value)}
          />
        </Match>
        <Match when={style() === "pixel"}>
          <SettingsSlider
            label="Block size"
            unit="px"
            min={2}
            max={8}
            step={1}
            value={tuning().pixel.block}
            onInput={(value) => setLogoTuning("pixel", "block", value)}
          />
          <SettingsSlider
            label="Steps"
            unit=""
            min={2}
            max={16}
            step={1}
            value={tuning().pixel.steps}
            onInput={(value) => setLogoTuning("pixel", "steps", value)}
          />
        </Match>
        <Match when={style() === "dither"}>
          <SettingsSlider
            label="Dot size"
            unit="px"
            min={1}
            max={4}
            step={1}
            value={tuning().dither.dot}
            onInput={(value) => setLogoTuning("dither", "dot", value)}
          />
          <SettingsSelect
            label="Pattern"
            options={["bayer 4×4", "bayer 2×2"] as const}
            value={tuning().dither.pattern}
            onChange={(value) => setLogoTuning("dither", "pattern", value)}
          />
          <SettingsSlider
            label="Steps"
            unit=""
            min={2}
            max={16}
            step={1}
            value={tuning().dither.steps}
            onInput={(value) => setLogoTuning("dither", "steps", value)}
          />
        </Match>
        <Match when={style() === "scanline"}>
          <SettingsSlider
            label="Line spacing"
            unit="px"
            min={2}
            max={8}
            step={1}
            value={tuning().scanline.spacing}
            onInput={(value) => setLogoTuning("scanline", "spacing", value)}
          />
          <SettingsSelect
            label="Direction"
            options={["down", "up"] as const}
            value={tuning().scanline.direction}
            onChange={(value) => setLogoTuning("scanline", "direction", value)}
          />
          <SettingsSlider
            label="Steps"
            unit=""
            min={2}
            max={16}
            step={1}
            value={tuning().scanline.steps}
            onInput={(value) => setLogoTuning("scanline", "steps", value)}
          />
        </Match>
        <Match when={style() === "type"}>
          <SettingsSlider
            label="Steps"
            unit=""
            min={2}
            max={20}
            step={1}
            value={tuning().type.steps}
            onInput={(value) => setLogoTuning("type", "steps", value)}
          />
          <SettingsSelect
            label="Direction"
            options={["left to right", "right to left"] as const}
            value={tuning().type.direction}
            onChange={(value) => setLogoTuning("type", "direction", value)}
          />
        </Match>
        <Match when={style() === "wipe"}>
          <Easing style="wipe" />
          <SettingsSelect
            label="Direction"
            options={["left to right", "right to left"] as const}
            value={tuning().wipe.direction}
            onChange={(value) => setLogoTuning("wipe", "direction", value)}
          />
          <SettingsSelect
            label="Line"
            options={toggles}
            value={tuning().wipe.line}
            onChange={(value) => setLogoTuning("wipe", "line", value)}
          />
          <SettingsSlider
            label="Line thickness"
            unit="px"
            min={1}
            max={4}
            step={1}
            value={tuning().wipe.thickness}
            onInput={(value) => setLogoTuning("wipe", "thickness", value)}
          />
        </Match>
        <Match when={style() === "glitch"}>
          <SettingsSlider
            label="Slices"
            unit=""
            min={2}
            max={6}
            step={1}
            value={tuning().glitch.slices}
            onInput={(value) => setLogoTuning("glitch", "slices", value)}
          />
          <SettingsSlider
            label="Max offset"
            unit="px"
            min={1}
            max={12}
            step={1}
            value={tuning().glitch.offset}
            onInput={(value) => setLogoTuning("glitch", "offset", value)}
          />
        </Match>
      </Switch>
      <SettingsSlider
        label="Swap every"
        unit="s"
        min={1}
        max={8}
        step={0.1}
        value={siteSettings.logoInterval}
        onInput={(value) => setSiteSetting("logoInterval", value)}
      />
      <button type="button" data-slot="jump" onClick={replayLogos}>
        Replay
      </button>
    </>
  )
}

function Easing(props: { style: "fade" | "blur" | "rise" | "scale" | "flip" | "wipe" }) {
  return (
    <SettingsSelect
      label="Easing"
      options={logoEasings}
      value={siteSettings.logoTuning[props.style].easing}
      onChange={(value) => setLogoTuning(props.style, "easing", value)}
    />
  )
}
