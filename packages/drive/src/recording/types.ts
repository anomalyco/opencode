export { TextStyle } from "../frame/index.js"

export interface CapturedSpan {
  text: string
  width: number
  readonly fg: Color
  readonly bg: Color
  readonly attributes: number
}

export interface CapturedLine {
  readonly spans: ReadonlyArray<CapturedSpan>
}

export interface CapturedFrame {
  readonly cols: number
  readonly rows: number
  readonly cursor: { readonly row: number; readonly col: number; readonly visible: boolean } | readonly [number, number]
  readonly lines: ReadonlyArray<CapturedLine>
}

export type Color = number | readonly [number, number, number, number]

export interface SampledFrame {
  atMs: number
  frame: CapturedFrame
}

export interface TimelineHeader {
  type: "header"
  version: 1
  cols: number
  rows: number
  encoding: "base64"
}

export interface TimelineOutput {
  type: "output"
  at_ms: number
  data: string
}

export interface TimelineResize {
  type: "resize"
  at_ms: number
  cols: number
  rows: number
}

export type TimelineRecord = TimelineHeader | TimelineOutput | TimelineResize
