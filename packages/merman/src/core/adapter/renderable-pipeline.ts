export interface DiagramRenderablePipelineOptions<Diagram, Grid> {
  parse: () => Diagram
  draw: (diagram: Diagram) => Grid
  publish: (grid: Grid) => void
  didDraw?: (grid: Grid) => void
}

type DiagramRenderableInvalidation = "grid" | "style"

export class DiagramRenderablePipeline<Diagram, Grid> {
  private _diagram?: Diagram
  private _grid?: Grid
  private _batchDepth = 0
  private _pending?: DiagramRenderableInvalidation

  constructor(private readonly options: DiagramRenderablePipelineOptions<Diagram, Grid>) {}

  diagram(): Diagram {
    this._diagram ??= this.options.parse()
    return this._diagram
  }

  batchUpdate(update: () => void): void {
    this._batchDepth += 1
    try {
      update()
    } finally {
      this._batchDepth -= 1
      if (this._batchDepth === 0 && this._pending) {
        const pending = this._pending
        this._pending = undefined
        this.render(pending)
      }
    }
  }

  invalidateParsedDiagram(): void {
    this._diagram = undefined
    this.invalidateGrid()
  }

  invalidateGrid(): void {
    this._grid = undefined
    this.invalidate("grid")
  }

  invalidateStyle(): void {
    this.invalidate("style")
  }

  private invalidate(level: DiagramRenderableInvalidation): void {
    if (this._batchDepth > 0) {
      if (level === "grid" || !this._pending) this._pending = level
      return
    }
    this.render(level)
  }

  private render(level: DiagramRenderableInvalidation): void {
    let grid = this._grid
    if (level === "grid" || !grid) {
      grid = this.options.draw(this.diagram())
      this._grid = grid
      this.options.didDraw?.(grid)
    }
    this.options.publish(grid)
  }
}
