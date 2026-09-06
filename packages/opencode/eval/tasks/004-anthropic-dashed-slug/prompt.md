When routing Anthropic models through the Cloudflare AI Gateway, the model IDs from models.dev use dotted versions (e.g., `claude-haiku-4.5`), but Anthropic's Messages API expects dashed native slugs (e.g., `claude-haiku-4-5`). The current code passes the dotted ID directly, causing 404 errors.

Fix `packages/opencode/src/provider/provider.ts` in the Anthropic AI Gateway routing section. When processing model IDs that start with `anthropic/`, replace all dots with dashes in the model ID before passing it to the Anthropic client. This translation is lossless because no native Anthropic slug contains a dot.

Also update the test helper `gatewayModel` in `packages/opencode/test/provider/cf-ai-gateway-e2e.test.ts` to apply the same dot-to-dash translation.

Write a test that verifies `anthropic/claude-haiku-4.5` reaches Anthropic as `claude-haiku-4-5`.


