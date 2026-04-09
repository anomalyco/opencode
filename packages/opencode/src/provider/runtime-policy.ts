import type { Provider } from "./provider"

const policy = <T extends Provider.Model["runtime"]>(value: T) => value

export const PROVIDER_RUNTIME_POLICY = {
  apim: {
    maxActiveTools: 128,
    toolPriority: [
      "task",
      "bash",
      "read",
      "glob",
      "grep",
      "apply_patch",
      "edit",
      "write",
      "webfetch",
      "todoread",
      "todowrite",
      "question",
      "skill",
      "websearch",
      "codesearch",
      "batch",
      "lsp",
      "planexit",
    ] as string[],
  },
  groq: {
    systemPrompt: "groq",
    maxActiveTools: 4,
    toolPriority: ["bash", "read", "glob", "grep"] as string[],
  },
} satisfies Record<string, Provider.Model["runtime"]>

export const MODEL_RUNTIME_POLICY = {
  "groq/compound": policy({
    disableLocalTools: true,
  }),
  "groq/compound-mini": policy({
    disableLocalTools: true,
  }),
  "groq/llama-3.1-8b-instant": policy({
    maxActiveTools: 1,
  }),
} satisfies Record<string, Provider.Model["runtime"]>
