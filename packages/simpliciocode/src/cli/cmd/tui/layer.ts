import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@simpliciocode/core/npm"
import { Observability } from "@simpliciocode/core/effect/observability"

export const CliLayer = Observability.layer.pipe(Layer.merge(TuiConfig.layer), Layer.provide(Npm.defaultLayer))
