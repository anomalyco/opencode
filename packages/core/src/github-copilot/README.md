# GitHub Copilot AI SDK Adapters

This directory contains upstream-derived AI SDK implementations adapted for
GitHub Copilot. It is not a generic OpenAI-compatible provider.

## Provenance

- `chat/` is derived from the Vercel AI SDK
  `@ai-sdk/openai-compatible` chat implementation.
- `responses/` is derived from the Vercel AI SDK `@ai-sdk/openai` Responses
  implementation.
- The exact upstream revisions originally copied into this repository are
  unknown. Current dependency versions and the `VERSION` constant in
  `copilot-provider.ts` are not copy provenance.

## Ownership

Keep `chat/` and `responses/` structurally close to their upstream modules, but
preserve the intentional Copilot adaptations: the `copilot` options and metadata
namespace, `thinking_budget`, reasoning text and opaque reasoning, stateless
Responses requests with encrypted reasoning, rotating response item IDs, and
explicit function-tool strictness taking precedence over the global fallback.

`copilot-provider.ts` is the local adapter assembly entrypoint used by
`plugin/provider/github-copilot.ts`. `models.ts` is OpenCode-owned catalog
reconciliation, not vendored SDK code. Authentication, request headers, model
routing, and integration lifecycle are also owned by the provider plugin.

When updating the upstream-shaped modules, compare against both source packages
and reapply the documented Copilot adaptations. Focused regression coverage is
in:

- `test/github-copilot/copilot-chat-model.test.ts`
- `test/github-copilot/convert-to-copilot-messages.test.ts`
- `test/github-copilot/openai-responses-language-model.test.ts`
- `test/github-copilot/openai-responses-prepare-tools.test.ts`
- `test/github-copilot/models.test.ts`
- `test/plugin/provider-github-copilot.test.ts`
