import { ai } from "../../src/effect.js"
import { Azure } from "../../src/providers.js"

const model = Azure.configure({ resourceName: "example" }).responses("deployment")

ai.text.request({ model, prompt: "Hello", providerOptions: { store: false } })

ai.text.request({
  model,
  prompt: "Hello",
  // @ts-expect-error Azure OpenAI store must be boolean.
  providerOptions: { store: "false" },
})
