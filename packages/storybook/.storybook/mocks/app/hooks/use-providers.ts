const model_id = "claude-3-7-sonnet"

const provider = {
  id: "anthropic",
  models: {
    [model_id]: {
      id: model_id,
      name: "Claude 3.7 Sonnet",
      cost: { input: 1, output: 1 },
      variants: { fast: {}, thinking: {} },
    },
  },
}

export function useProviders() {
  return {
    all: () => [provider],
    default: () => ({ anthropic: model_id }),
    connected: () => [provider],
    paid: () => [provider],
    popular: () => [provider],
  }
}
