import { lazy } from "solid-js"
import type { Component } from "solid-js"
import type { VisualSpec } from "./spec"

const PlotVisual = lazy(() => import("./renderers/plot").then((module) => ({ default: module.PlotVisual })))

export const RENDERERS: Record<VisualSpec["kind"], Component<{ spec: VisualSpec }>> = {
  plot: PlotVisual,
}
