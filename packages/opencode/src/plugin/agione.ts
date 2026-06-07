import type { Plugin } from "@opencode-ai/plugin"

export const AgioneAuthPlugin: Plugin = async () => ({
  auth: {
    provider: "agione",
    methods: [
      {
        type: "api",
        label: "API key",
      },
    ],
  },
})
