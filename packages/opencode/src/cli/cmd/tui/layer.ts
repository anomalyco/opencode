import { Layer } from "effect"
import { TuiConfig } from "./config/tui"
import { Npm } from "@opencode-ai/shared/npm"

export const TuiLayer = TuiConfig.layer.pipe(Layer.provide(Npm.defaultLayer))
