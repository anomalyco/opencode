# DECISION_142 Learning Delta (2026-02-25)

## Decision Link

- `STR4TEG15T/memory/decisions/DECISION_142_NATE_ALMA_SSH_CONTROL_PLANE_AND_DELIVERABLE_GOVERNANCE.md`

## Assimilated Truth

- Railway SSH sessions are TTY-biased, so direct binary stream pull can corrupt archives when captured naively.
- Reliable pull requires base64 marker framing from remote command output, then local decode.
- Reliable push over Railway SSH can be achieved with chunked base64 append commands and remote decode/apply.
- Keeping target IDs in one local config file prevents path drift and command ambiguity across future requests.
- Verbose failure-point logging with per-run `TraceId` materially reduces diagnosis time on SSH transport failures.
- Continuity checkpoints (`srv/state/continuity.json`) create deterministic resume points for next-session takeover.

## Reusable Anchors

- `nate alma pull base64 markers railway ssh`
- `nate alma push chunked base64 railway ssh`
- `openclaw no redeploy maintenance control plane`
- `openfixer verbose failure-point logging methodology`
- `nate alma continuity checkpoint resume`

## Evidence Paths

- `OP3NF1XER/nate-alma/dev/tools/railway-ssh.ps1`
- `OP3NF1XER/nate-alma/dev/tools/pull-remote-state.ps1`
- `OP3NF1XER/nate-alma/dev/tools/push-remote-bundle.ps1`
- `OP3NF1XER/nate-alma/dev/tools/openclaw-config-over-ssh.ps1`
- `OP3NF1XER/nate-alma/srv/pulls/nate-alma-smoke3-20260224-212134.tar.gz`
- `OP3NF1XER/nate-alma/srv/logs/*trace*.log`
- `OP3NF1XER/nate-alma/srv/state/continuity.json`
