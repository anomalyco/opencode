import { ModelID, type ProviderID } from "./schema/ids.js"
import type { LanguageModel } from "./schema/options.js"
import type { ImageModel } from "./image.js"

/**
 * A provider-scoped model name bound to its configured facade. Callable facades return one of these so
 * `LLM.request({ model: openai("gpt-5") })` and `Image.request({ model: openai("gpt-image-2") })` name a model once
 * and let the request namespace pick the selector (`facade.model`, `facade.image`, …) on demand.
 */
export class ModelRef<S extends ModelRef.Selectors = ModelRef.Selectors> {
  constructor(
    readonly id: ModelID,
    readonly facade: S,
  ) {}

  get provider() {
    return this.facade.id
  }
}

export namespace ModelRef {
  /** The named selectors a configured provider facade exposes; `model` is the default LLM route. */
  export interface Selectors {
    readonly id: ProviderID
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    readonly model: (id: ModelID) => LanguageModel<any, any>
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    readonly image?: (id: ModelID) => ImageModel<any>
  }

  /** A ref whose provider exposes an image route. */
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  export type WithImage = ModelRef<Selectors & { readonly image: (id: ModelID) => ImageModel<any> }>

  /** Make a configured facade callable: `openai("gpt-5")` returns a `ModelRef` over the facade's own selectors. */
  export const facade = <const S extends Selectors>(selectors: S) =>
    Object.assign((id: string | ModelID) => new ModelRef(ModelID.make(id), selectors), selectors)
}

/** The concrete `LanguageModel` a request will run against: either the model itself or the ref's `model` selector. */
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type ResolveLanguageModel<Model> =
  Model extends LanguageModel<any, any> ? Model : Model extends ModelRef<infer S> ? ReturnType<S["model"]> : never

/** The concrete `ImageModel` a request will run against: either the model itself or the ref's `image` selector. */
// oxlint-disable-next-line typescript-eslint/no-explicit-any
export type ResolveImageModel<Model> =
  Model extends ImageModel<any>
    ? Model
    : Model extends ModelRef<infer S>
      ? S extends { readonly image: (id: ModelID) => infer Selected }
        ? Selected
        : never
      : never
