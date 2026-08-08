import { RGBA } from "@opentui/core"
import { createColorRampTheme, type DiagramRgb } from "../core/color/style.js"
import type { BaseStateCellStyle, NoteConnectorRampStyle, StateCellStyle } from "./types.js"

const DEFAULT_THEME_RGB = {
  state: [228, 239, 232],
  composite: [111, 138, 126],
  transition: [134, 225, 200],
  label: [134, 225, 200],
  noteBorder: [141, 169, 155],
  noteText: [215, 229, 221],
  noteConnector: [141, 169, 155],
  start: [134, 225, 200],
  end: [230, 177, 126],
  choice: [134, 225, 200],
} as const satisfies Record<BaseStateCellStyle, DiagramRgb>
const NOTE_CONNECTOR_RAMP_STYLES = [
  "noteConnectorRamp1",
  "noteConnectorRamp2",
  "noteConnectorRamp3",
] as const satisfies readonly NoteConnectorRampStyle[]
export type StateStyleColors = Required<Record<StateCellStyle, RGBA>>

export function resolveStateStyleColors(
  colors: Partial<Record<BaseStateCellStyle, RGBA | undefined>> = {},
): StateStyleColors {
  const resolved = {
    state: colors.state ?? RGBA.fromInts(...DEFAULT_THEME_RGB.state, 255),
    composite: colors.composite ?? RGBA.fromInts(...DEFAULT_THEME_RGB.composite, 255),
    transition: colors.transition ?? RGBA.fromInts(...DEFAULT_THEME_RGB.transition, 255),
    label: colors.label ?? RGBA.fromInts(...DEFAULT_THEME_RGB.label, 255),
    noteBorder: colors.noteBorder ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteBorder, 255),
    noteText: colors.noteText ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteText, 255),
    noteConnector: colors.noteConnector ?? RGBA.fromInts(...DEFAULT_THEME_RGB.noteConnector, 255),
    start: colors.start ?? RGBA.fromInts(...DEFAULT_THEME_RGB.start, 255),
    end: colors.end ?? RGBA.fromInts(...DEFAULT_THEME_RGB.end, 255),
    choice: colors.choice ?? RGBA.fromInts(...DEFAULT_THEME_RGB.choice, 255),
  }
  return {
    ...resolved,
    ...createColorRampTheme(NOTE_CONNECTOR_RAMP_STYLES, resolved.noteConnector, resolved.noteBorder),
  }
}
