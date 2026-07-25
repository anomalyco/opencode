# Proposal: Map llama-skein reasoning capability in model discovery

## Why

llama-skein now advertises a `reasoning` boolean per model in /v1/models
(companion change advertise-reasoning-capability). opencode's
discoverOpenAICompatibleModels defaulted discovered local models to
capabilities.reasoning=false, so reasoning models (streaming reasoning_content
first) rendered as a frozen "not responding" during the think phase.

## What

- In discoverOpenAICompatibleModels, read `item.reasoning` from the /v1/models
  response and set capabilities.reasoning from it. A hand-configured provider
  model capability still wins over discovery (existing-first merge preserved).

## Non-goals

- Changing reasoning rendering itself (already gated on capabilities.reasoning).
- Client regen: discovery reads the raw /models JSON, so no generated-client
  change is required for this mapping.
