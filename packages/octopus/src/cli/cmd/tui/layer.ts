import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@octopus-ai/core/npm"
import { Observability } from "@octopus-ai/core/effect/observability"

export const CliLayer = Observability.layer.pipe(Layer.merge(TuiConfig.layer), Layer.provide(Npm.defaultLayer))
