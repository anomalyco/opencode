export type FlexDirection = "row" | "column"
export type AlignItems = "stretch" | "start" | "center" | "end"
export type JustifyContent = "start" | "center" | "end" | "space-between" | "space-around"

export interface LayoutProps {
  direction?: FlexDirection
  grow?: number
  shrink?: number
  basis?: number
  padding?: [number, number, number, number]
  margin?: [number, number, number, number]
  borderWidth?: number
}

export interface LayoutNode extends LayoutProps {
  x: number
  y: number
  width: number
  height: number
  children: LayoutNode[]
}

export interface LayoutResult {
  x: number
  y: number
  width: number
  height: number
}
