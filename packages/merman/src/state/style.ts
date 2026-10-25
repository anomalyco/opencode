import { RGBA } from "@opentui/core"
import { createColorRampTheme, numberedStyleKeys, rgba, type DiagramRgb } from "../core/color/style.js"
import type { BaseStateCellStyle, NoteConnectorRampStyle, StateCellStyle, StateDepartureRampStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  stateBorder: [228, 239, 232],
  composite: [111, 138, 126],
  compositeLabel: [111, 138, 126],
  transition: [134, 225, 200],
  label: [134, 225, 200],
  noteBorder: [141, 169, 155],
  noteText: [215, 229, 221],
  noteConnector: [141, 169, 155],
  start: [134, 225, 200],
  end: [230, 177, 126],
  choice: [134, 225, 200],
} as const satisfies Record<BaseStateCellStyle, DiagramRgb>
const STATE_RAMP_STEPS = [1, 2, 3] as const
export const NOTE_CONNECTOR_RAMP_STYLES = numberedStyleKeys(
  "noteConnectorRamp",
  STATE_RAMP_STEPS,
) satisfies readonly NoteConnectorRampStyle[]
export const STATE_DEPARTURE_RAMP_STYLES = numberedStyleKeys(
  "stateDepartureRamp",
  STATE_RAMP_STEPS,
) satisfies readonly StateDepartureRampStyle[]
export type StateStyleColors = Required<Record<StateCellStyle, RGBA>>

export function resolveStateStyleColors(
  colors: Partial<Record<BaseStateCellStyle, RGBA | undefined>> = {},
): StateStyleColors {
  const resolved = {
    state: colors.state ?? rgba(DEFAULT_THEME_RGB.state),
    stateBorder: colors.stateBorder ?? colors.state ?? rgba(DEFAULT_THEME_RGB.stateBorder),
    composite: colors.composite ?? rgba(DEFAULT_THEME_RGB.composite),
    compositeLabel: colors.compositeLabel ?? colors.composite ?? rgba(DEFAULT_THEME_RGB.compositeLabel),
    transition: colors.transition ?? rgba(DEFAULT_THEME_RGB.transition),
    label: colors.label ?? rgba(DEFAULT_THEME_RGB.label),
    noteBorder: colors.noteBorder ?? rgba(DEFAULT_THEME_RGB.noteBorder),
    noteText: colors.noteText ?? rgba(DEFAULT_THEME_RGB.noteText),
    noteConnector: colors.noteConnector ?? rgba(DEFAULT_THEME_RGB.noteConnector),
    start: colors.start ?? rgba(DEFAULT_THEME_RGB.start),
    end: colors.end ?? rgba(DEFAULT_THEME_RGB.end),
    choice: colors.choice ?? rgba(DEFAULT_THEME_RGB.choice),
  }
  return {
    ...resolved,
    ...createColorRampTheme(NOTE_CONNECTOR_RAMP_STYLES, resolved.noteConnector, resolved.noteBorder),
    ...createColorRampTheme(STATE_DEPARTURE_RAMP_STYLES, resolved.stateBorder, resolved.transition),
  }
}
