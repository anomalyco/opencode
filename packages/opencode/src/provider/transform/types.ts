import type { ModelMessage } from "ai"
import type { Provider } from "../provider"

export type Input = {
  model: Provider.Model
  sessionID: string
  providerOptions?: Record<string, any>
}

export type Variants = Record<string, Record<string, any>>

export type Transform = {
  options: (input: Input) => Record<string, any>
  variants: (model: Provider.Model) => Variants
  small: (model: Provider.Model) => Record<string, any>
  normalize?: (msgs: ModelMessage[], model: Provider.Model, options: Record<string, unknown>) => ModelMessage[]
  cache?: (msgs: ModelMessage[], model: Provider.Model) => ModelMessage[]
}
