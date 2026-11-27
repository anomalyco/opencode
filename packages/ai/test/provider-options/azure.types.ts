import { ai } from "../../src/effect.js"
import { Azure } from "../../src/providers.js"

const model = Azure.responsesModel("deployment", { resourceName: "example" })

ai.request({ model, prompt: "Hello", providerOptions: { store: false } })

ai.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Azure OpenAI store must be boolean.
  providerOptions: { store: "false" },
})
