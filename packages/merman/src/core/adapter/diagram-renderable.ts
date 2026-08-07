import {
  TextBufferRenderable,
  type ColorInput,
  type RenderContext,
  type RGBA,
  type StyledText,
  type TextBufferOptions,
} from "@opentui/core"
import type { DiagramCanvas, DiagramCanvasTextOptions } from "../canvas.js"
import { setDiagramRenderableColor } from "./renderable-color.js"
import { DiagramRenderablePipeline } from "./renderable-pipeline.js"

interface DiagramRenderableOptions<Diagram, Grid extends DiagramCanvas<any, any>> {
  parse: () => Diagram
  draw: (diagram: Diagram) => Grid
  publish: (grid: Grid) => StyledText
  measure?: DiagramCanvasTextOptions
}

export abstract class DiagramRenderable<Diagram, Grid extends DiagramCanvas<any, any>> extends TextBufferRenderable {
  private _content: string
  private _renderedWidth = 0
  private _renderedHeight = 0
  private _pipeline?: DiagramRenderablePipeline<Diagram, Grid>

  protected constructor(ctx: RenderContext, options: TextBufferOptions & { content?: string }) {
    super(ctx, { ...options, wrapMode: options.wrapMode ?? "none" })
    this._content = options.content ?? ""
  }

  protected initializeDiagram(options: DiagramRenderableOptions<Diagram, Grid>): void {
    this._pipeline = new DiagramRenderablePipeline({
      parse: options.parse,
      draw: options.draw,
      didDraw: (grid) => {
        const size = grid.getTextSize(options.measure)
        this._renderedWidth = size.width
        this._renderedHeight = size.height
      },
      publish: (grid) => {
        this.textBuffer.setStyledText(options.publish(grid))
        this.updateTextInfo()
      },
    })
    this._pipeline.invalidateParsedDiagram()
  }

  get content(): string {
    return this._content
  }

  set content(value: string) {
    if (this._content === value) return
    this._content = value
    this.contentChanged()
    this.pipeline.invalidateParsedDiagram()
  }

  get renderedWidth(): number {
    return this._renderedWidth
  }

  get renderedHeight(): number {
    return this._renderedHeight
  }

  batchUpdate(update: () => void): void {
    this.pipeline.batchUpdate(update)
  }

  protected contentChanged(): void {}

  protected parsedDiagram(): Diagram {
    return this.pipeline.diagram()
  }

  protected invalidateGrid(): void {
    this.pipeline.invalidateGrid()
  }

  protected invalidateStyle(): void {
    this.pipeline.invalidateStyle()
  }

  protected setColor(
    current: RGBA | undefined,
    value: ColorInput | undefined,
    assign: (color: RGBA | undefined) => void,
  ): void {
    setDiagramRenderableColor(current, value, assign, () => this.invalidateStyle())
  }

  private get pipeline(): DiagramRenderablePipeline<Diagram, Grid> {
    if (!this._pipeline) throw new Error("Diagram renderable was not initialized")
    return this._pipeline
  }
}
