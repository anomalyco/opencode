export { TextStyle } from "../frame/index.js"

export interface CapturedSpan {
  text: string
  width: number
  fg: number
  bg: number
  attributes: number
}

export interface CapturedLine {
  spans: CapturedSpan[]
}

export interface CapturedFrame {
  cols: number
  rows: number
  cursor: { row: number; col: number; visible: boolean }
  lines: CapturedLine[]
}

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
