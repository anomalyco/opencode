import type { V2ColorValue } from "../types"
import { V2_AVATAR_DARK, V2_AVATAR_LIGHT } from "./avatar"

const ref = (name: string): V2ColorValue => `var(--${name})`

const light: Record<string, V2ColorValue> = {
  "v2-background-bg-base": ref("v2-grey-100"),
  "v2-background-bg-deep": ref("v2-grey-200"),
  "v2-background-bg-layer-01": ref("v2-grey-300"),
  "v2-background-bg-layer-02": ref("v2-grey-400"),
  "v2-background-bg-layer-03": ref("v2-grey-500"),
  "v2-background-bg-inverse": ref("v2-grey-1000"),
  "v2-background-bg-contrast": ref("v2-grey-900"),
  "v2-background-bg-button-neutral": ref("v2-grey-100"),
  "v2-background-bg-accent": ref("v2-blue-600"),
  "v2-text-text-inverse": ref("v2-grey-100"),
  "v2-text-text-contrast": ref("v2-grey-100"),
  "v2-text-text-accent": ref("v2-blue-600"),
  "v2-text-text-accent-hover": ref("v2-blue-700"),
  "v2-icon-icon-base": ref("v2-grey-1000"),
  "v2-icon-icon-muted": ref("v2-grey-800"),
  "v2-icon-icon-inverse": ref("v2-grey-100"),
  "v2-icon-icon-contrast": ref("v2-grey-200"),
  "v2-icon-icon-accent": ref("v2-blue-600"),
  "v2-icon-icon-accent-hover": ref("v2-blue-700"),
  "v2-border-border-muted": ref("v2-alpha-dark-8"),
  "v2-border-border-base": ref("v2-alpha-dark-10"),
  "v2-border-border-strong": ref("v2-alpha-dark-20"),
  "v2-border-border-inverse": ref("v2-grey-1000"),
  "v2-border-border-focus": ref("v2-blue-500"),
  "v2-overlay-simple-overlay-hover": ref("v2-alpha-dark-4"),
  "v2-overlay-simple-overlay-pressed": ref("v2-alpha-dark-8"),
  "v2-overlay-simple-overlay-contrast-hover": ref("v2-alpha-light-12"),
  "v2-overlay-simple-overlay-contrast-pressed": ref("v2-alpha-light-24"),
  "v2-overlay-simple-overlay-scrim": ref("v2-alpha-dark-40"),
  "v2-overlay-gradient-depth-overlay-depth-top": ref("v2-alpha-light-100"),
  "v2-overlay-gradient-depth-overlay-depth-bot": ref("v2-alpha-light-0"),
  "v2-overlay-simple-tab-active-scrim": "#fafafa00",
  "v2-overlay-simple-tab-hover-scrim": "#eeeeee00",
  "v2-overlay-simple-tab-scrim": "#fafafa00",
  "v2-state-bg-success": ref("v2-green-100"),
  "v2-state-fg-success": ref("v2-green-800"),
  "v2-state-border-success": ref("v2-green-300"),
  "v2-state-bg-warning": ref("v2-yellow-100"),
  "v2-state-fg-warning": ref("v2-yellow-800"),
  "v2-state-border-warning": ref("v2-yellow-300"),
  "v2-state-bg-danger": ref("v2-red-100"),
  "v2-state-fg-danger": ref("v2-red-800"),
  "v2-state-border-danger": ref("v2-red-300"),
  "v2-state-bg-info": ref("v2-blue-100"),
  "v2-state-fg-info": ref("v2-blue-800"),
  "v2-state-border-info": ref("v2-blue-300"),
  ...V2_AVATAR_LIGHT,
  "v2-elevation-raised":
    "0px 2px 4px 0px var(--v2-alpha-dark-4), 0px 1px 2px -1px var(--v2-alpha-dark-8), 0px 0px 0px 0.5px var(--v2-alpha-dark-12), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
  "v2-elevation-floating":
    "0px 8px 16px 0px var(--v2-alpha-dark-4), 0px 4px 8px 0px var(--v2-alpha-dark-8), 0px 0px 0px 0.5px var(--v2-alpha-dark-12), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
  "v2-elevation-overlay":
    "0px 16px 32px 0px var(--v2-alpha-dark-4), 0px 8px 16px 0px var(--v2-alpha-dark-8), 0px 0px 0px 0.5px var(--v2-alpha-dark-12), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
  "v2-elevation-button-neutral":
    "0px 1px 1.5px 0px var(--v2-alpha-dark-10), 0px 0px 0px 0.5px var(--v2-alpha-dark-14), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
  "v2-elevation-button-contrast":
    "0px 1px 1.5px 0px var(--v2-alpha-dark-20), 0px 0px 0px 0.5px var(--v2-grey-800), inset 0px 1px 2px 0px var(--v2-alpha-light-14), inset 0px -1px 2px 0px var(--v2-alpha-dark-6), 0px 0px 0px 0px var(--v2-alpha-dark-0)",
  "v2-elevation-elements": "0px 0.5px 0.5px 0px var(--v2-alpha-dark-40)",
  "v2-elevation-switch-off":
    "inset 0px 1px 1px 0px var(--v2-alpha-dark-8), inset 0px 0.5px 0.5px 0px var(--v2-alpha-dark-8), inset 0px 0px 0px 0.5px var(--v2-alpha-dark-10)",
  "v2-elevation-switch-on":
    "inset 0px 2px 2px 0px var(--v2-alpha-dark-10), inset 0px 1px 1px 0px var(--v2-alpha-dark-10), inset 0px 0px 0px 0.5px var(--v2-alpha-dark-20)",
  "v2-illustration-illustration-layer-01": ref("v2-grey-300"),
  "v2-illustration-illustration-layer-02": ref("v2-grey-400"),
  "v2-illustration-illustration-layer-03": ref("v2-grey-500"),
}

const dark: Record<string, V2ColorValue> = {
  "v2-background-bg-base": ref("v2-grey-1000"),
  "v2-background-bg-deep": ref("v2-grey-1100"),
  "v2-background-bg-layer-01": ref("v2-grey-800"),
  "v2-background-bg-layer-02": ref("v2-grey-600"),
  "v2-background-bg-layer-03": ref("v2-grey-500"),
  "v2-background-bg-inverse": ref("v2-grey-100"),
  "v2-background-bg-contrast": ref("v2-grey-700"),
  "v2-background-bg-button-neutral": ref("v2-alpha-light-6"),
  "v2-background-bg-accent": ref("v2-blue-600"),
  "v2-text-text-inverse": ref("v2-grey-1000"),
  "v2-text-text-contrast": ref("v2-grey-100"),
  "v2-text-text-accent": ref("v2-blue-400"),
  "v2-text-text-accent-hover": ref("v2-blue-300"),
  "v2-icon-icon-base": ref("v2-grey-300"),
  "v2-icon-icon-muted": ref("v2-grey-400"),
  "v2-icon-icon-inverse": ref("v2-grey-1000"),
  "v2-icon-icon-contrast": ref("v2-grey-200"),
  "v2-icon-icon-accent": ref("v2-blue-400"),
  "v2-icon-icon-accent-hover": ref("v2-blue-300"),
  "v2-border-border-muted": ref("v2-alpha-light-8"),
  "v2-border-border-base": ref("v2-alpha-light-10"),
  "v2-border-border-strong": ref("v2-alpha-light-20"),
  "v2-border-border-inverse": ref("v2-grey-100"),
  "v2-border-border-focus": ref("v2-blue-500"),
  "v2-overlay-simple-overlay-hover": ref("v2-alpha-light-6"),
  "v2-overlay-simple-overlay-pressed": ref("v2-alpha-light-10"),
  "v2-overlay-simple-overlay-contrast-hover": ref("v2-alpha-dark-24"),
  "v2-overlay-simple-overlay-contrast-pressed": ref("v2-alpha-dark-40"),
  "v2-overlay-simple-overlay-scrim": ref("v2-alpha-light-30"),
  "v2-overlay-gradient-depth-overlay-depth-top": ref("v2-alpha-light-100"),
  "v2-overlay-gradient-depth-overlay-depth-bot": ref("v2-alpha-light-0"),
  "v2-overlay-simple-tab-active-scrim": "#24242400",
  "v2-overlay-simple-tab-hover-scrim": "#3a3a3a00",
  "v2-overlay-simple-tab-scrim": "#08080800",
  "v2-state-bg-success": ref("v2-green-1200"),
  "v2-state-fg-success": ref("v2-green-500"),
  "v2-state-border-success": ref("v2-green-900"),
  "v2-state-bg-warning": ref("v2-yellow-1200"),
  "v2-state-fg-warning": ref("v2-yellow-500"),
  "v2-state-border-warning": ref("v2-yellow-900"),
  "v2-state-bg-danger": ref("v2-red-1200"),
  "v2-state-fg-danger": ref("v2-red-500"),
  "v2-state-border-danger": ref("v2-red-900"),
  "v2-state-bg-info": ref("v2-blue-1200"),
  "v2-state-fg-info": ref("v2-blue-500"),
  "v2-state-border-info": ref("v2-blue-900"),
  ...V2_AVATAR_DARK,
  "v2-elevation-raised":
    "0px 2px 4px 0px var(--v2-alpha-dark-30), 0px 1px 2px 0px var(--v2-alpha-dark-30), 0px 0px 0px 0.5px var(--v2-alpha-light-16), 0px -0.5px 0px 0px var(--v2-alpha-light-6)",
  "v2-elevation-floating":
    "0px 8px 16px 0px var(--v2-alpha-dark-30), 0px 4px 8px 0px var(--v2-alpha-dark-30), 0px 0px 0px 0.5px var(--v2-alpha-light-16), 0px -0.5px 0px 0px var(--v2-alpha-light-6)",
  "v2-elevation-overlay":
    "0px 16px 32px 0px var(--v2-alpha-dark-30), 0px 8px 16px 0px var(--v2-alpha-dark-30), 0px 0px 0px 0.5px var(--v2-alpha-light-16), 0px -0.5px 0px 0px var(--v2-alpha-light-6)",
  "v2-elevation-button-neutral":
    "0px 1px 2px 0px var(--v2-alpha-dark-40), 0px 0px 0px 0.5px var(--v2-alpha-light-20), 0px -0.5px 0px 0px var(--v2-alpha-light-10)",
  "v2-elevation-button-contrast":
    "0px 1px 2px 0px var(--v2-alpha-dark-40), 0px 0px 0px 0.5px var(--v2-alpha-light-40), inset 0px 0px 0px 0px var(--v2-alpha-light-0), inset 0px 0px 0px 0px var(--v2-alpha-light-0), 0px -0.5px 0px 0px var(--v2-alpha-light-30)",
  "v2-elevation-elements": "0px 0.5px 0.5px 0px var(--v2-alpha-dark-40)",
  "v2-elevation-switch-off":
    "inset 0px -0.5px 0px 0px var(--v2-alpha-light-10), inset 0px 0px 0px 0px var(--v2-alpha-light-0), inset 0px 0px 0px 0.5px var(--v2-alpha-light-16)",
  "v2-elevation-switch-on":
    "inset 0px -0.5px 0px 0px var(--v2-alpha-light-10), inset 0px 0px 0px 0px var(--v2-alpha-light-0), inset 0px 0px 0px 0.5px var(--v2-alpha-light-16)",
  "v2-illustration-illustration-layer-01": ref("v2-grey-900"),
  "v2-illustration-illustration-layer-02": ref("v2-grey-800"),
  "v2-illustration-illustration-layer-03": ref("v2-grey-700"),
}

export function mapV2Semantics(isDark: boolean): Record<string, V2ColorValue> {
  return isDark ? dark : light
}

export function mergeV2Tokens(
  ...layers: Record<string, V2ColorValue>[]
): Record<string, V2ColorValue> {
  return Object.assign({}, ...layers)
}
