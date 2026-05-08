<!-- Context: openagents-repo/agents | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Custom Agents in OpenCode

Plugins can register custom AI agents that have specific roles, instructions, and toolsets.

## Agent Definition

Custom agents are configured in the plugin's `config` function.

```typescript
export const registerCustomAgents = (config) => {
  return {
    ...config,
    agents: [
      {
        name: "my-helper",
        description: "A friendly assistant for this project",
        instructions: "You are a helpful assistant. Use your tools to help the user.",
        model: "claude-3-5-sonnet-latest", // Specify the model
        tools: ["say_hello", "read", "write"] // Reference built-in or custom tools
      }
    ]
  };
};
```

## Integrating into Plugin

The `config` method in the plugin return object is used to register agents.

```typescript
export const MyPlugin: Plugin = async (context) => {
  return {
    config: async (currentConfig) => {
      return registerCustomAgents(currentConfig);
    },
    // ... other properties
  };
};
```

## Agent Capabilities
- **Model Choice**: You can select specific models for different agents.
- **Scoped Tools**: Limit what tools an agent can use to ensure safety or focus.
- **System Instructions**: Define the "personality" and rules for the agent.
