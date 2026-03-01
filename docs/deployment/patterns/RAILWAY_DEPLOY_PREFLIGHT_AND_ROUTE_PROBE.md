# Pattern: Railway Deploy Preflight and Route Probe

## Trigger

Any OpenClaw deployment pass on Railway where operator expects new route exposure.

## Mandatory Sequence

1. Verify CLI install and version (`railway --version`).
2. Verify active auth (`railway whoami`) before any `railway link`/`railway up`.
3. Verify project/service link (`railway status`).
4. Verify required mount path contract before deploy:
   - if `railway.toml` sets `requiredMountPath`, attach a matching volume first.
   - on Windows Git Bash, use `MSYS2_ARG_CONV_EXCL='*'` when passing `/data` style mount paths.
5. Deploy (`railway up --detach`) only after auth, link, and volume contract pass.
6. Probe runtime endpoints (`/`, `/healthz`, `/openclaw`, `/setup/export`, `/textbook/`).
7. Classify `/textbook/` response kind:
   - `textbook-static`: textbook exposure succeeded.
   - `openclaw-spa-shell`: route mapping still points to control UI shell.

## Evidence Rule

Record command outputs and route classification in deployment journal with blocker owner.

## Closure Rule

Do not mark deployment `Close` if Railway auth is missing or textbook route classification is `openclaw-spa-shell`.
