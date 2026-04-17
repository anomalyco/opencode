import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@/npm"
import { Observability } from "@/effect/observability"

export const CliLayer = Observability.layer.pipe(Layer.merge(TuiConfig.layer), Layer.provide(Npm.defaultLayer))
