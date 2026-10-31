import { Azure } from "../../src/providers.js"
import { LLMRequest } from "../../src/effect.js"

const model = Azure.configure({ resourceName: "example" }).responses("deployment")

LLMRequest.from({ model, prompt: "Hello", providerOptions: { store: false } })

LLMRequest.from({
  model,
  prompt: "Hello",
  // @ts-expect-error Azure OpenAI store must be boolean.
  providerOptions: { store: "false" },
})
