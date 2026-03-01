# Pattern: OpenClaw Pre-Deploy Backup and Restore Guard

## Trigger

Any deployment that touches wrapper routing, workspace sync, or setup surface.

## Mandatory Steps

1. Capture backup via authenticated `/setup/export` before deploy.
2. Record deployment id before and after rollout.
3. Verify `/setup/api/status` and `/setup/api/debug` post-rollout.
4. If `configured:false`, enter restore mode immediately.

## Restore Mode

1. Gather Telegram and model auth credentials.
2. Execute setup with explicit auth choice payload.
3. Verify channel bindings and gateway status.
4. Export fresh backup after successful restore.
5. Validate Control UI token path when dashboard reports `1008` unauthorized:
   - verify `gateway.auth.mode=token`
   - verify `gateway.remote.token` exists
   - paste token in Control UI settings for remote browser clients

## Closure Rule

Do not close incident while `configured:false` or Telegram channel is unbound.
