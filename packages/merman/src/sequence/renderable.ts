import { type BorderStyle, type ColorInput, type RenderContext, type RGBA } from "@opentui/core"
import { DiagramRenderable } from "../core/adapter/diagram-renderable.js"
import { parseDiagramRenderableColor } from "../core/adapter/renderable-color.js"
import { brightenColor } from "../core/color/style.js"
import { drawSequenceDiagramGrid } from "./drawing.js"
import { DEFAULT_FRAGMENT_BORDER_STYLE, normalizeSequenceMinParticipantGap } from "./options.js"
import { parseMermaidSequenceDiagram } from "./parser.js"
import { renderSequenceGridStyledText, type SequenceGrid } from "./render-grid.js"
import { resolveSequenceStyleColors } from "./style.js"
import type { SequenceDiagram, SequenceDiagramOptions } from "./types.js"

export class SequenceDiagramRenderable extends DiagramRenderable<SequenceDiagram, SequenceGrid> {
  private _compact: boolean
  private _minParticipantGap: number
  private _fragmentBorderStyle: BorderStyle
  private _participantColor?: RGBA
  private _lifelineColor?: RGBA
  private _groupColor?: RGBA
  private _requestColor?: RGBA
  private _responseColor?: RGBA
  private _noteColor?: RGBA
  private _noteBackgroundColor?: RGBA
  constructor(ctx: RenderContext, options: SequenceDiagramOptions = {}) {
    super(ctx, options)
    this._compact = options.compact ?? false
    this._minParticipantGap = normalizeSequenceMinParticipantGap(options.minParticipantGap)
    this._fragmentBorderStyle = options.fragmentBorderStyle ?? DEFAULT_FRAGMENT_BORDER_STYLE
    this._participantColor = parseDiagramRenderableColor(options.participantColor)
    this._lifelineColor = parseDiagramRenderableColor(options.lifelineColor)
    this._groupColor = parseDiagramRenderableColor(options.groupColor)
    this._requestColor = parseDiagramRenderableColor(options.requestColor)
    this._responseColor = parseDiagramRenderableColor(options.responseColor)
    this._noteColor = parseDiagramRenderableColor(options.noteColor)
    this._noteBackgroundColor = parseDiagramRenderableColor(options.noteBackgroundColor)
    this.initializeDiagram({
      parse: () => parseMermaidSequenceDiagram(this.content),
      draw: (diagram) => this.drawGrid(diagram),
      publish: (grid) => this.styledText(grid),
    })
  }

  get compact(): boolean {
    return this._compact
  }

  set compact(value: boolean) {
    if (this._compact === value) return
    this._compact = value
    this.invalidateGrid()
  }

  get minParticipantGap(): number {
    return this._minParticipantGap
  }

  set minParticipantGap(value: number) {
    const next = normalizeSequenceMinParticipantGap(value)
    if (this._minParticipantGap === next) return
    this._minParticipantGap = next
    this.invalidateGrid()
  }

  get fragmentBorderStyle(): BorderStyle {
    return this._fragmentBorderStyle
  }

  set fragmentBorderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_FRAGMENT_BORDER_STYLE
    if (this._fragmentBorderStyle === next) return
    this._fragmentBorderStyle = next
    this.invalidateGrid()
  }

  get participantColor(): RGBA | undefined {
    return this._participantColor
  }

  set participantColor(value: ColorInput | undefined) {
    this.setColor(this._participantColor, value, (color) => {
      this._participantColor = color
    })
  }

  get lifelineColor(): RGBA | undefined {
    return this._lifelineColor
  }

  set lifelineColor(value: ColorInput | undefined) {
    this.setColor(this._lifelineColor, value, (color) => {
      this._lifelineColor = color
    })
  }

  get groupColor(): RGBA | undefined {
    return this._groupColor
  }

  set groupColor(value: ColorInput | undefined) {
    this.setColor(this._groupColor, value, (color) => {
      this._groupColor = color
    })
  }

  get requestColor(): RGBA | undefined {
    return this._requestColor
  }

  set requestColor(value: ColorInput | undefined) {
    this.setColor(this._requestColor, value, (color) => {
      this._requestColor = color
    })
  }

  get responseColor(): RGBA | undefined {
    return this._responseColor
  }

  set responseColor(value: ColorInput | undefined) {
    this.setColor(this._responseColor, value, (color) => {
      this._responseColor = color
    })
  }

  get noteColor(): RGBA | undefined {
    return this._noteColor
  }

  set noteColor(value: ColorInput | undefined) {
    this.setColor(this._noteColor, value, (color) => {
      this._noteColor = color
    })
  }

  get noteBackgroundColor(): RGBA | undefined {
    return this._noteBackgroundColor
  }

  set noteBackgroundColor(value: ColorInput | undefined) {
    this.setColor(this._noteBackgroundColor, value, (color) => {
      this._noteBackgroundColor = color
    })
  }

  private drawGrid(diagram: SequenceDiagram): SequenceGrid {
    return drawSequenceDiagramGrid(diagram, {
      compact: this._compact,
      minParticipantGap: this._minParticipantGap,
      fragmentBorderStyle: this._fragmentBorderStyle,
    })
  }

  private styledText(grid: SequenceGrid) {
    return renderSequenceGridStyledText(
      grid,
      resolveSequenceStyleColors({
        participant: this._participantColor,
        lifeline: this._lifelineColor,
        group: this._groupColor ?? brightenColor(this._lifelineColor, 0.08),
        request: this._requestColor,
        response: this._responseColor,
        fragment: brightenColor(this._lifelineColor, 0.18),
        fragmentLabelBg: this._noteBackgroundColor,
        note: this._noteColor,
        noteBg: this._noteBackgroundColor,
      }),
    )
  }
}
