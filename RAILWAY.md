# OpenCode Veritly on Railway

## Remote Bun debug (fixed ports)

Set **`VERITLY_REMOTE_DEBUG=1`** on a **dedicated** non-production service instance when you need to attach a debugger. Any other value (including unset) keeps the normal startup without Bun inspectors.

| Process | Inspector bind | Port |
| --- | --- | --- |
| OpenCode (`start-opencode-serve`) | `0.0.0.0` | **9229** |
| sdk-relay | `0.0.0.0` | **9230** |
| serve-custom-app (edge) | `0.0.0.0` | **9231** |

Inspectors use `bun --inspect=0.0.0.0:<port>` (no `--inspect-wait`), so health checks are not blocked.

### Security

Exposing debug ports to the public internet is a serious risk (arbitrary code execution surface). Use only on isolated staging instances, restrict access, and remove `VERITLY_REMOTE_DEBUG` when finished.

### Operator: Railway TCP

Expose **three** separate TCP endpoints on Railway, one per port above, pointing at the same service/container. Railway assigns a public hostname (and often a distinct port) for each mapping. Use those values as the **host** (and **port** if shown) when attaching from your IDE.

The image documents the ports via `EXPOSE 9229 9230 9231`; you still configure TCP exposure in the Railway dashboard.

### WebStorm

Repo run configurations under `.idea/runConfigurations/` (`Railway OpenCode inspect 9229`, `Railway sdk-relay inspect 9230`, `Railway edge inspect 9231`) default to `http://127.0.0.1:<port>` with path mapping **`/app`** → **`$PROJECT_DIR$/vendor/opencode-veritly`**. Replace the host (and port if Railway assigns one) with the Railway TCP values for your service.
