import { LLM } from "../../src/index.js"
import { Azure } from "../../src/providers.js"

const model = Azure.configure({ resourceName: "example" }).responses("deployment")

LLM.request({ model, prompt: "Hello", providerOptions: { openai: { store: false } } })

LLM.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Azure OpenAI store must be boolean.
  providerOptions: { openai: { store: "false" } },
})
