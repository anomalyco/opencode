import { Image, ImageModel, LanguageModel, LLM, LLMRequest, ModelRef, type ResolveLanguageModel } from "../src/index.js"
import type { OpenAIImageOptions } from "../src/protocols/openai-images.js"
import type { GoogleImageOptions } from "../src/protocols/google-images.js"
import type { OpenAIProviderOptionsInput } from "../src/providers/openai-options.js"
import { Anthropic, Google, OpenAI } from "../src/providers.js"

type Equal<A, B> = [A, B] extends [B, A] ? true : false
type Assert<T extends true> = T

const openai = OpenAI.configure({ apiKey: "test" })
const google = Google.configure({ apiKey: "test" })
const anthropic = Anthropic.configure({ apiKey: "test" })

// The callable facade keeps its named selectors.
openai.responses("gpt-5")
openai.chat("gpt-4o")
openai.image("gpt-image-2")
openai.model("gpt-5")
openai.configure({ apiKey: "other" })

// Refs carry lazy routes and resolve per request namespace.
const ref = openai("gpt-5")
type RefIsModelRef = Assert<Equal<typeof ref extends ModelRef ? true : false, true>>
type RefResolvesResponses = Assert<Equal<ResolveLanguageModel<typeof ref>, ReturnType<typeof openai.responses>>>
type RefOptions = Assert<
  Equal<
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    ResolveLanguageModel<typeof ref> extends LanguageModel<infer Options, any> ? Options : never,
    OpenAIProviderOptionsInput
  >
>
void (true satisfies RefOptions)
void (true satisfies RefIsModelRef)
void (true satisfies RefResolvesResponses)

// LLM.request infers providerOptions from the ref's llm route.
const llmRequest = LLM.request({ model: ref, prompt: "Hello", providerOptions: { reasoningEffort: "high" } })
type LLMRequestIsTyped = Assert<Equal<typeof llmRequest extends LLMRequest ? true : false, true>>
void (true satisfies LLMRequestIsTyped)
LLM.request({
  model: ref,
  prompt: "Hello",
  // @ts-expect-error Known OpenAI options retain their value kinds through the ref.
  providerOptions: { reasoningEffort: 1 },
})
LLM.request({
  model: anthropic("claude-sonnet-4-5"),
  prompt: "Hello",
  providerOptions: { thinking: { type: "enabled", budgetTokens: 1024 } },
})
LLM.generate(LLM.request({ model: google("gemini-2.5-pro"), prompt: "Hello" }))

// Image.request infers providerOptions from the ref's image route.
const imageRequest = Image.request({
  model: openai("gpt-image-2"),
  prompt: "A lighthouse",
  providerOptions: { quality: "high" },
})
type ImageRequestOptions = Assert<Equal<typeof imageRequest.providerOptions, OpenAIImageOptions | undefined>>
type ImageRequestModel = Assert<Equal<typeof imageRequest.model, ImageModel<OpenAIImageOptions>>>
void (true satisfies ImageRequestOptions)
void (true satisfies ImageRequestModel)
// @ts-expect-error Known OpenAI image options retain their value kinds through the ref.
Image.request({ model: openai("gpt-image-2"), prompt: "A lighthouse", providerOptions: { outputCompression: "80" } })
const googleImage = Image.request({
  model: google("gemini-image"),
  prompt: "A lighthouse",
  providerOptions: { imageSize: "2K" },
})
type GoogleImageRequestOptions = Assert<Equal<typeof googleImage.providerOptions, GoogleImageOptions | undefined>>
void (true satisfies GoogleImageRequestOptions)
// @ts-expect-error Known Google image options retain their value kinds through the ref.
Image.request({ model: google("gemini-image"), prompt: "A lighthouse", providerOptions: { includeThoughts: "yes" } })

// Providers without an image route are rejected at compile time.
// @ts-expect-error Anthropic exposes no image route.
Image.request({ model: anthropic("claude-sonnet-4-5"), prompt: "A lighthouse" })
// @ts-expect-error Anthropic exposes no image route.
Image.generate({ model: anthropic("claude-sonnet-4-5"), prompt: "A lighthouse" })
type AnthropicFacade = ReturnType<typeof anthropic>["facade"]
type AnthropicHasNoImage = Assert<Equal<AnthropicFacade extends { readonly image: unknown } ? true : false, false>>
void (true satisfies AnthropicHasNoImage)

// Concrete models keep working everywhere a ref is accepted.
LLM.request({ model: openai.responses("gpt-5"), prompt: "Hello" })
Image.request({ model: openai.image("gpt-image-2"), prompt: "A lighthouse" })
// @ts-expect-error A language model is not an image model.
Image.request({ model: openai.responses("gpt-5"), prompt: "A lighthouse" })
// @ts-expect-error An image model is not a language model.
LLM.request({ model: openai.image("gpt-image-2"), prompt: "Hello" })
