import type { RGBA } from "@opentui/core"
import type { PromptBarState } from "./prompt-bar-state"

export type PromptBarLayoutSpec = {
  content_padding_left: number
  content_padding_right: number
  content_padding_top: number
  textarea_min_height: number
  textarea_max_height: number
  footer_padding_top: number
  footer_row_height: number
  separator_height: number
  status_row_height: number
}

export function promptBarLayoutSpec(): PromptBarLayoutSpec {
  return {
    content_padding_left: 2,
    content_padding_right: 2,
    content_padding_top: 1,
    textarea_min_height: 1,
    textarea_max_height: 6,
    footer_padding_top: 1,
    footer_row_height: 1,
    separator_height: 1,
    status_row_height: 1,
  }
}

export function promptBarLayoutHeight(spec = promptBarLayoutSpec()) {
  const base = spec.content_padding_top + spec.footer_padding_top + spec.footer_row_height
  const shared = spec.separator_height + spec.status_row_height
  return {
    min: base + spec.textarea_min_height + shared,
    max: base + spec.textarea_max_height + shared,
  }
}

export function promptBarAnimationEnabled(config: boolean | undefined, override: boolean) {
  if (config) return true
  return override
}

export function promptBarUseLegacyLayout(enabled: boolean, plugin: string) {
  if (!enabled) return true
  return plugin === "state-static"
}

export function promptBarUseLegacyLayoutForTheme(enabled: boolean, plugin: string, background: RGBA) {
  if (background.a === 0) return true
  return promptBarUseLegacyLayout(enabled, plugin)
}

export function promptBarPluginEnabled(useLegacyLayout: boolean) {
  return !useLegacyLayout
}

export function promptBarSpatialRippleActive(input: {
  pluginEnabled: boolean
  plugin: string
  state: PromptBarState
  hasContent: boolean
  idleCycleEnabled: boolean
}) {
  if (!input.pluginEnabled) return false
  if (input.plugin !== "diagonal-ripple") return false
  if (input.state !== "idle") return false
  if (input.hasContent) return false
  return input.idleCycleEnabled
}

export function promptBarBackground(input: { useLegacyLayout: boolean; overlay: RGBA | undefined; background: RGBA }) {
  if (input.useLegacyLayout) return input.background
  return input.overlay ?? input.background
}

export function promptBarResetEnabled(current: string, configured: string, override: boolean) {
  if (current !== configured) return true
  return override
}

export function promptBarSurface(input: {
  useLegacyLayout: boolean
  background: RGBA
  chromeVisible: boolean
  spatialRippleActive: boolean
}) {
  const background = input.spatialRippleActive ? undefined : input.background
  return {
    shellBackground: input.useLegacyLayout || input.spatialRippleActive ? undefined : input.background,
    contentBackground: background,
    separatorBackground: input.useLegacyLayout || input.spatialRippleActive ? undefined : input.background,
    separatorBorderColor: background,
    separatorVertical: input.chromeVisible ? "╹" : " ",
    separatorHorizontal: input.chromeVisible ? "▀" : " ",
    shouldFill: !input.spatialRippleActive,
  }
}

export function promptBarBottomLeft(useLegacyLayout: boolean) {
  void useLegacyLayout
  return "╹"
}
