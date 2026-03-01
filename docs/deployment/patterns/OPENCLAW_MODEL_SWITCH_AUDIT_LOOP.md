# Pattern: OpenClaw Model Switch Audit Loop

## Trigger

Any claim that OpenClaw has switched Anthropic runtime model tiers (Opus, Sonnet, Haiku).

## Mandatory Loop

1. Run pre-audit preview against config (no mutation).
2. Review planned change paths and target model id.
3. Apply config mutation.
4. Restart gateway.
5. Run post-audit and capture restart/status output.
6. Confirm live endpoint behavior after restart.

## Evidence Rule

Deployment notes must include both `PRE-AUDIT` and `POST-AUDIT` blocks and cannot rely on narrative-only claims.

## Closure Rule

Do not mark model switch complete unless config mutation + gateway restart + post-audit evidence are all present.
