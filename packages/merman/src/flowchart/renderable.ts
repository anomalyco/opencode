import { RGBA, type BorderStyle, type ColorInput, type RenderContext } from "@opentui/core"
import { DiagramRenderable } from "../core/adapter/diagram-renderable.js"
import { parseDiagramRenderableColor } from "../core/adapter/renderable-color.js"
import { diagramColorMapsEqual, normalizeDiagramColorMap } from "../core/color/map.js"
import { DEFAULT_BORDER_STYLE, drawFlowchartDiagramGrid } from "./drawing.js"
import type { FlowchartDiagramRenderOptions, FlowchartDiagramOptions } from "./options.js"
import { parseMermaidFlowchartDiagram } from "./parser.js"
import {
  renderGridStyledText,
  resolveFlowchartStyleColors,
  type FlowchartGrid,
  type FlowchartNodeColors,
} from "./style.js"
import type { FlowchartActiveEdgeSelection, FlowchartDiagram, FlowchartDirection, FlowchartEdge } from "./types.js"

interface IndexedFlowchartEdge {
  edge: FlowchartEdge
  index: number
}

function flowchartActiveEdgesEqual(
  left: FlowchartActiveEdgeSelection | undefined,
  right: FlowchartActiveEdgeSelection | undefined,
): boolean {
  return left?.from === right?.from && left?.to === right?.to && left?.index === right?.index
}

export class FlowchartDiagramRenderable extends DiagramRenderable<FlowchartDiagram, FlowchartGrid> {
  private _compact: boolean
  private _direction?: FlowchartDirection
  private _borderStyle: BorderStyle
  private _minNodeGap?: number
  private _minRankGap?: number
  private _layoutMaxWidth?: number
  private _nodeColor?: RGBA
  private _databaseColor?: RGBA
  private _edgeColor?: RGBA
  private _activeNodeColor?: RGBA
  private _activeEdgeColor?: RGBA
  private _nodeColors: Map<string, RGBA>
  private _nodeBgColors: Map<string, RGBA>
  private _labelColor?: RGBA
  private _groupColor?: RGBA
  private _activeNode?: string
  private _activeEdge?: FlowchartActiveEdgeSelection
  private _selectedConnectionIndex = 0
  constructor(ctx: RenderContext, options: FlowchartDiagramOptions = {}) {
    super(ctx, options)
    this._compact = options.compact ?? false
    this._direction = options.direction
    this._borderStyle = options.borderStyle ?? DEFAULT_BORDER_STYLE
    this._minNodeGap = options.minNodeGap
    this._minRankGap = options.minRankGap
    this._layoutMaxWidth = options.layoutMaxWidth
    this._nodeColor = parseDiagramRenderableColor(options.nodeColor)
    this._databaseColor = parseDiagramRenderableColor(options.databaseColor)
    this._edgeColor = parseDiagramRenderableColor(options.edgeColor)
    this._activeNodeColor = parseDiagramRenderableColor(options.activeNodeColor)
    this._activeEdgeColor = parseDiagramRenderableColor(options.activeEdgeColor)
    this._nodeColors = normalizeDiagramColorMap(options.nodeColors)
    this._nodeBgColors = normalizeDiagramColorMap(options.nodeBgColors)
    this._labelColor = parseDiagramRenderableColor(options.labelColor)
    this._groupColor = parseDiagramRenderableColor(options.groupColor)
    this._activeNode = options.activeNode
    this._activeEdge = options.activeEdge
    this.initializeDiagram({
      parse: () => parseMermaidFlowchartDiagram(this.content),
      draw: (diagram) => drawFlowchartDiagramGrid(diagram, this.renderOptions()),
      publish: (grid) => this.styledText(grid),
      measure: { trimTop: true, trimBottom: true },
    })
  }

  protected override contentChanged(): void {
    this._activeNode = undefined
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
  }

  get compact(): boolean {
    return this._compact
  }

  set compact(value: boolean) {
    if (this._compact === value) return
    this._compact = value
    this.invalidateGrid()
  }

  set direction(value: FlowchartDirection | undefined) {
    if (this._direction === value) return
    this._direction = value
    this.invalidateGrid()
  }

  set borderStyle(value: BorderStyle | undefined) {
    const next = value ?? DEFAULT_BORDER_STYLE
    if (this._borderStyle === next) return
    this._borderStyle = next
    this.invalidateGrid()
  }

  get layoutMaxWidth(): number | undefined {
    return this._layoutMaxWidth
  }

  set layoutMaxWidth(value: number | undefined) {
    if (this._layoutMaxWidth === value) return
    this._layoutMaxWidth = value
    this.invalidateGrid()
  }

  set nodeColor(value: ColorInput | undefined) {
    this.setColor(this._nodeColor, value, (color) => (this._nodeColor = color))
  }

  set databaseColor(value: ColorInput | undefined) {
    this.setColor(this._databaseColor, value, (color) => (this._databaseColor = color))
  }

  set edgeColor(value: ColorInput | undefined) {
    this.setColor(this._edgeColor, value, (color) => (this._edgeColor = color))
  }

  set activeNodeColor(value: ColorInput | undefined) {
    this.setColor(this._activeNodeColor, value, (color) => (this._activeNodeColor = color))
  }

  set activeEdgeColor(value: ColorInput | undefined) {
    this.setColor(this._activeEdgeColor, value, (color) => (this._activeEdgeColor = color))
  }

  set nodeColors(value: FlowchartNodeColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._nodeColors, next)) return
    this._nodeColors = next
    this.invalidateStyle()
  }

  set nodeBgColors(value: FlowchartNodeColors | undefined) {
    const next = normalizeDiagramColorMap(value)
    if (diagramColorMapsEqual(this._nodeBgColors, next)) return
    this._nodeBgColors = next
    this.invalidateStyle()
  }

  get activeNode(): string | undefined {
    return this._activeNode
  }

  set activeNode(value: string | undefined) {
    if (this._activeNode === value) return
    this._activeNode = value
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
    this.invalidateGrid()
  }

  get selectedConnectionIndex(): number {
    return this._selectedConnectionIndex
  }

  get selectedConnection(): FlowchartActiveEdgeSelection | undefined {
    const selected = this.selectedOutgoingEdge()
    return selected ? { from: selected.edge.from, to: selected.edge.to, index: selected.index } : undefined
  }

  get activeEdge(): FlowchartActiveEdgeSelection | undefined {
    return this._activeEdge
  }

  set activeEdge(value: FlowchartActiveEdgeSelection | undefined) {
    if (flowchartActiveEdgesEqual(this._activeEdge, value)) return
    this._activeEdge = value ? { ...value } : undefined
    this.invalidateGrid()
  }

  set labelColor(value: ColorInput | undefined) {
    this.setColor(this._labelColor, value, (color) => (this._labelColor = color))
  }

  set groupColor(value: ColorInput | undefined) {
    this.setColor(this._groupColor, value, (color) => (this._groupColor = color))
  }

  activateFirstNode(): string | undefined {
    if (this._activeNode) return this._activeNode
    const node = this.parsedDiagram().nodes[0]
    if (!node) return undefined
    this.activeNode = node.id
    return node.id
  }

  selectNextConnection(): FlowchartActiveEdgeSelection | undefined {
    return this.selectConnection(1)
  }

  selectPreviousConnection(): FlowchartActiveEdgeSelection | undefined {
    return this.selectConnection(-1)
  }

  private selectConnection(delta: 1 | -1): FlowchartActiveEdgeSelection | undefined {
    this.activateFirstNode()
    const outgoing = this.activeOutgoingEdges()
    if (outgoing.length === 0) return undefined
    this._activeEdge = undefined
    if (outgoing.length === 1) {
      this.invalidateGrid()
      return this.selectedConnection
    }
    this._selectedConnectionIndex = (this._selectedConnectionIndex + delta + outgoing.length) % outgoing.length
    this.invalidateGrid()
    return this.selectedConnection
  }

  followSelectedConnection(): string | undefined {
    const selected = this.selectedOutgoingEdge()
    if (!selected) return undefined
    this._activeNode = selected.edge.to
    this._activeEdge = undefined
    this._selectedConnectionIndex = 0
    this.invalidateGrid()
    return selected.edge.to
  }

  private activeOutgoingEdges(): IndexedFlowchartEdge[] {
    if (!this._activeNode) return []
    return this.parsedDiagram().edges.flatMap((edge, index) =>
      edge.from === this._activeNode ? [{ edge, index }] : [],
    )
  }

  private selectedOutgoingEdge(): IndexedFlowchartEdge | undefined {
    const outgoing = this.activeOutgoingEdges()
    if (outgoing.length === 0) return undefined
    const index = ((this._selectedConnectionIndex % outgoing.length) + outgoing.length) % outgoing.length
    return outgoing[index]
  }

  private renderOptions(): FlowchartDiagramRenderOptions {
    return {
      compact: this._compact,
      direction: this._direction,
      borderStyle: this._borderStyle,
      minNodeGap: this._minNodeGap,
      minRankGap: this._minRankGap,
      layoutMaxWidth: this._layoutMaxWidth,
      activeNode: this._activeNode,
      activeEdge: this._activeEdge ?? this.selectedConnection,
    }
  }

  private styledText(grid: FlowchartGrid) {
    return renderGridStyledText(
      grid,
      resolveFlowchartStyleColors({
        node: this._nodeColor,
        database: this._databaseColor,
        edge: this._edgeColor,
        activeNode: this._activeNodeColor,
        activeEdge: this._activeEdgeColor,
        label: this._labelColor,
        group: this._groupColor,
      }),
      this._nodeColors,
      this._nodeBgColors,
    )
  }
}
