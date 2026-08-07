import { type BorderStyle, type ColorInput, type RenderContext, type RGBA } from "@opentui/core"
import { DiagramRenderable } from "../core/adapter/diagram-renderable.js"
import { parseDiagramRenderableColor } from "../core/adapter/renderable-color.js"
import { diagramColorMapsEqual, normalizeDiagramColorMap } from "../core/color/map.js"
import { activeTransitionListsEqual, normalizeActiveTransitions } from "./active-transition.js"
import { drawStateDiagramGrid } from "./drawing.js"
import { DEFAULT_STATE_ARROW_HEAD_STYLE, DEFAULT_STATE_BORDER_STYLE, normalizeStateMinStateGap } from "./options.js"
import { parseMermaidStateDiagram } from "./parser.js"
import { renderStateGridStyledText, type StateGrid } from "./render-grid.js"
import { resolveStateStyleColors } from "./style.js"
import type {
  StateDiagramActiveTransition,
  StateDiagramActiveTransitionSelection,
  StateDiagramArrowHeadStyle,
  StateDiagramDirection,
  StateDiagramOptions,
  StateDiagramStateColors,
  StateDiagram,
} from "./types.js"

export class StateDiagramRenderable extends DiagramRenderable<StateDiagram, StateGrid> {
  private _direction?: StateDiagramDirection
  private _borderStyle: BorderStyle
  private _arrowHeadStyle: StateDiagramArrowHeadStyle
  private _minStateGap: number
  private _activeState?: string
  private _activeTransitions: StateDiagramActiveTransition[]
  private _stateColor?: RGBA
  private _activeStateColor?: RGBA
  private _compositeColor?: RGBA
  private _transitionColor?: RGBA
  private _activeTransitionColor?: RGBA
  private _labelColor?: RGBA
  private _noteBorderColor?: RGBA
  private _noteTextColor?: RGBA
  private _noteConnectorColor?: RGBA
  private _startColor?: RGBA
  private _endColor?: RGBA
  private _choiceColor?: RGBA
  private _stateColors: Map<string, RGBA>
  private _stateBgColors: Map<string, RGBA>
  constructor(ctx: RenderContext, options: StateDiagramOptions = {}) {
    super(ctx, options)
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_STATE_BORDER_STYLE
    this._arrowHeadStyle = options.arrowHeadStyle ?? DEFAULT_STATE_ARROW_HEAD_STYLE
    this._minStateGap = normalizeStateMinStateGap(options.minStateGap)
    this._activeState = options.activeState
    this._activeTransitions = normalizeActiveTransitions(options.activeTransition)
    this._stateColor = parseDiagramRenderableColor(options.stateColor)
    this._activeStateColor = parseDiagramRenderableColor(options.activeStateColor)
    this._compositeColor = parseDiagramRenderableColor(options.compositeColor)
    this._transitionColor = parseDiagramRenderableColor(options.transitionColor)
    this._activeTransitionColor = parseDiagramRenderableColor(options.activeTransitionColor)
    this._labelColor = parseDiagramRenderableColor(options.labelColor)
    this._noteBorderColor = parseDiagramRenderableColor(options.noteBorderColor)
    this._noteTextColor = parseDiagramRenderableColor(options.noteTextColor)
    this._noteConnectorColor = parseDiagramRenderableColor(options.noteConnectorColor)
    this._startColor = parseDiagramRenderableColor(options.startColor)
    this._endColor = parseDiagramRenderableColor(options.endColor)
    this._choiceColor = parseDiagramRenderableColor(options.choiceColor)
    this._stateColors = normalizeDiagramColorMap(options.stateColors)
    this._stateBgColors = normalizeDiagramColorMap(options.stateBgColors)
    this.initializeDiagram({
      parse: () => parseMermaidStateDiagram(this.content),
      draw: (diagram) => this.drawGrid(diagram),
      publish: (grid) => this.styledText(grid),
      measure: { trimBottom: true },
    })
  }

  get activeState(): string | undefined {
    return this._activeState
  }

  set activeState(value: string | undefined) {
    if (this._activeState === value) return
    this._activeState = value
    this.invalidateGrid()
  }

  get direction(): StateDiagramDirection | undefined {
    return this._direction
  }

  set direction(value: StateDiagramDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this.invalidateGrid()
  }

  get borderStyle(): BorderStyle {
    return this._borderStyle
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_STATE_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateGrid()
  }

  get minStateGap(): number {
    return this._minStateGap
  }

  set minStateGap(value: number | undefined) {
    const next = normalizeStateMinStateGap(value)
    if (this._minStateGap === next) return
    this._minStateGap = next
    this.invalidateGrid()
  }

  get activeTransition(): StateDiagramActiveTransitionSelection | undefined {
    if (this._activeTransitions.length === 0) return undefined
    if (this._activeTransitions.length === 1) return this._activeTransitions[0]
    return [...this._activeTransitions]
  }

  set activeTransition(value: StateDiagramActiveTransitionSelection | undefined) {
    const next = normalizeActiveTransitions(value)
    if (activeTransitionListsEqual(this._activeTransitions, next)) return
    this._activeTransitions = next
    this.invalidateGrid()
  }

  get arrowHeadStyle(): StateDiagramArrowHeadStyle {
    return this._arrowHeadStyle
  }

  set arrowHeadStyle(value: StateDiagramArrowHeadStyle | undefined) {
    const next = value ?? DEFAULT_STATE_ARROW_HEAD_STYLE
    if (this._arrowHeadStyle === next) return
    this._arrowHeadStyle = next
    this.invalidateGrid()
  }

  set stateColor(value: ColorInput | undefined) {
    this.setColor(this._stateColor, value, (color) => (this._stateColor = color))
  }

  set activeStateColor(value: ColorInput | undefined) {
    this.setColor(this._activeStateColor, value, (color) => (this._activeStateColor = color))
  }

  set compositeColor(value: ColorInput | undefined) {
    this.setColor(this._compositeColor, value, (color) => (this._compositeColor = color))
  }

  set transitionColor(value: ColorInput | undefined) {
    this.setColor(this._transitionColor, value, (color) => (this._transitionColor = color))
  }

  set activeTransitionColor(value: ColorInput | undefined) {
    this.setColor(this._activeTransitionColor, value, (color) => (this._activeTransitionColor = color))
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set noteBorderColor(value: ColorInput | undefined) {
    this.setColor(this._noteBorderColor, value, (color) => (this._noteBorderColor = color))
  }

  set noteTextColor(value: ColorInput | undefined) {
    this.setColor(this._noteTextColor, value, (color) => (this._noteTextColor = color))
  }

  set noteConnectorColor(value: ColorInput | undefined) {
    this.setColor(this._noteConnectorColor, value, (color) => (this._noteConnectorColor = color))
  }

  set startColor(value: ColorInput | undefined) {
    this.setColor(this._startColor, value, (color) => (this._startColor = color))
  }

  set endColor(value: ColorInput | undefined) {
    this.setColor(this._endColor, value, (color) => (this._endColor = color))
  }

  set choiceColor(value: ColorInput | undefined) {
    this.setColor(this._choiceColor, value, (color) => (this._choiceColor = color))
  }

  set stateColors(value: StateDiagramStateColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._stateColors, next)) return
    this._stateColors = next
    this.invalidateStyle()
  }

  set stateBgColors(value: StateDiagramStateColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._stateBgColors, next)) return
    this._stateBgColors = next
    this.invalidateStyle()
  }

  private drawGrid(diagram: StateDiagram): StateGrid {
    return drawStateDiagramGrid(diagram, {
      direction: this._direction,
      borderStyle: this._borderStyle,
      arrowHeadStyle: this._arrowHeadStyle,
      minStateGap: this._minStateGap,
      activeState: this._activeState,
      activeTransition: this._activeTransitions,
    })
  }

  private styledText(grid: StateGrid) {
    return renderStateGridStyledText(
      grid,
      resolveStateStyleColors({
        state: this._stateColor,
        activeState: this._activeStateColor,
        composite: this._compositeColor,
        transition: this._transitionColor,
        activeTransition: this._activeTransitionColor,
        label: this._labelColor,
        noteBorder: this._noteBorderColor,
        noteText: this._noteTextColor,
        noteConnector: this._noteConnectorColor,
        start: this._startColor,
        end: this._endColor,
        choice: this._choiceColor,
      }),
      this._stateColors,
      this._stateBgColors,
    )
  }
}
