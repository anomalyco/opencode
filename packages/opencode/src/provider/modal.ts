import { ModelsDev } from "./models"

export const MODAL_PROVIDER = {
  id: "modal",
  name: "Modal",
  env: ["MODAL_API_KEY"],
  models: {
    "zai-org/GLM-5-FP8": {
      id: "zai-org/GLM-5-FP8",
      name: "GLM-5",
      family: "",
      release_date: "",
      attachment: false,
      reasoning: false,
      temperature: true,
      tool_call: true,
      options: {},
      limit: {
        context: 8192,
        output: 4096,
      },
      modalities: {
        input: ["text"],
        output: ["text"],
      },
      provider: {
        npm: "@ai-sdk/openai-compatible",
        api: "https://api.us-west-2.modal.direct/v1",
      },
    },
  },
} satisfies ModelsDev.Provider
