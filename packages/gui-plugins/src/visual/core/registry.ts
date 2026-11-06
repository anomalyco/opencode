import { lazy } from "solid-js"
import type { Component } from "solid-js"
import type { VisualSpec } from "./spec"

const DiagramVisual = lazy(() => import("./renderers/diagram").then((module) => ({ default: module.DiagramVisual })))

const PlotVisual = lazy(() => import("./renderers/plot").then((module) => ({ default: module.PlotVisual })))

const TaskVisual = lazy(() => import("./renderers/task").then((module) => ({ default: module.TaskVisual })))

const MechanismVisual = lazy(() => import("./renderers/mechanism").then((module) => ({ default: module.MechanismVisual })))

const BeamVisual = lazy(() => import("./renderers/beam").then((module) => ({ default: module.BeamVisual })))

const MohrVisual = lazy(() => import("./renderers/mohr").then((module) => ({ default: module.MohrVisual })))

const StressStrainVisual = lazy(() => import("./renderers/stress-strain").then((module) => ({ default: module.StressStrainVisual })))

const PvVisual = lazy(() => import("./renderers/pv").then((module) => ({ default: module.PvVisual })))

const ToleranceVisual = lazy(() => import("./renderers/tolerance").then((module) => ({ default: module.ToleranceVisual })))

const FlowVisual = lazy(() => import("./renderers/flow").then((module) => ({ default: module.FlowVisual })))

const AssemblyVisual = lazy(() => import("./renderers/assembly").then((module) => ({ default: module.AssemblyVisual })))


export const RENDERERS: Record<VisualSpec["kind"], Component<{ spec: VisualSpec }>> = {
  diagram: DiagramVisual,
  plot: PlotVisual,
  mechanism: MechanismVisual,
  beam: BeamVisual,
  mohr: MohrVisual,
  "stress-strain": StressStrainVisual,
  pv: PvVisual,
  tolerance: ToleranceVisual,
  flow: FlowVisual,
  assembly: AssemblyVisual,
  task: TaskVisual,
}
