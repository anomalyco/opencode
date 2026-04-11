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

### `railway ssh` and “map ports to localhost”

You **cannot** combine `railway ssh` with OpenSSH-style forwarding such as `-L 9229:127.0.0.1:9229`. The CLI rejects `-L`, and [Railway’s SSH docs](https://docs.railway.com/cli/ssh) state there is **no tunneling or port forwarding** (the session uses Railway’s WebSocket protocol, not a normal OpenSSH server).

So there is **no** supported one-liner to mirror **9229 / 9230 / 9231** onto `127.0.0.1` on your laptop for WebStorm’s localhost attach configs. Use **public TCP** hostnames (below) or the **Veritly production** run configurations that point at those hosts.

**Shell into the container** (logs, `curl`, `ps`, etc.):

```bash
railway ssh \
  --project=86738b69-8f2d-4c02-a200-203d6ce45499 \
  --environment=873f901a-166d-4927-9750-766ef644dbcc \
  --service=46b533f9-d347-4147-9417-c3900ff4a78d
```

Same thing via repo helper (override IDs with `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID` if needed):

```bash
bash vendor/opencode-veritly/railway/railway-ssh-opencode-veritly.sh
```

### WebStorm

Repo run configurations under `.idea/runConfigurations/` (`Railway OpenCode inspect 9229`, `Railway sdk-relay inspect 9230`, `Railway edge inspect 9231`) default to `http://127.0.0.1:<port>` with path mapping **`/app`** → **`$PROJECT_DIR$/vendor/opencode-veritly`**. Those localhost URIs only work when something on your machine is actually listening on those ports (e.g. local Bun), **not** via `railway ssh`. For the hosted service, use the **Veritly production …** configs or paste the public TCP URLs from the table below.

**Why JetBrains wants port ≥ 1024:** On Unix, ports **1–1023** are privileged (only root can bind). WebStorm’s remote Node/Bun attach UI validates the debugger port so you don’t point at a privileged port by mistake. **1024 is the minimum allowed**, not the port you must use. The fixed inspector ports here (**9229–9231**) are all safely above that.

If you hand-edit a run config and hit validation errors, check you didn’t typo **9229** as **929** or another three-digit port.

### Tailscale (in container)

The image installs Tailscale and runs **`tailscaled`** in **userspace** mode (no `/dev/net/tun`, no extra caps) before OpenCode starts. Logs print **`tailscale version`** on boot.

| Variable | Purpose |
| --- | --- |
| **`TAILSCALE_AUTHKEY`** | Pre-auth key from the [Tailscale admin console](https://login.tailscale.com/admin/settings/keys). If unset, the node does not join a tailnet (OK for local `debug.bun.sh` smoke tests). |
| **`TAILSCALE_HOSTNAME`** | Machine name in Tailscale (default `opencode-veritly`). |

After deploy, attach debuggers over Tailscale to the container’s **Tailscale IP** (same ports **9229–9231**), avoiding public TCP.

**Local Docker:** from `vendor/opencode-veritly`, run `bash debug.bun.sh` (builds with `VERITLY_DEBUG_BUILD=1`, publishes **3000** + inspector ports). The image build runs `tailscale version` so Tailscale is present before push; runtime boot runs `/usr/local/bin/start-tailscale` (see `railway/start-tailscale.sh` in the repo).

**Debug frontend build:** `VERITLY_DEBUG_BUILD=1` turns off JS/CSS minification (no obfuscation). Full **sourcemaps** are opt-in via `VERITLY_DEBUG_SOURCEMAP=1` (heavy memory use during `vite build`; omit in small Docker builders).

### Example: Veritly hosted (opencode-veritly)

Concrete wiring for the production-style hosted service: TCP mappings on Railway, plus Cloudflare hostnames for the app and per-inspector debug names.

| Role | Public host | Port | Notes |
| --- | --- | --- | --- |
| OpenCode inspector | `opencode-veritly-production-4a4e.up.railway.app` | **9229** | Railway-generated domain; target port **9229** in Railway networking. |
| sdk-relay inspector | `debug-veritly-9230.veritly.co.uk` | **9230** | Cloudflare **DNS** must point at Railway; if the dashboard shows **Cloudflare proxy**, the Bun inspector WebSocket may not work until the record is **DNS only** (grey cloud) or you use a direct TCP path Railway documents. |
| serve-custom-app (edge) inspector | `debug-veritly-9231.veritly.co.uk` | **9231** | Same as 9230: confirm DNS is live; proxy can block debugger attach. |
| Browser / HTTP app (not an inspector) | `test1.veritly.co.uk` | **8080** | Public entry with **Cloudflare proxy**; this is the normal app port, not a substitute for the inspector URLs above. |

**Attach URIs for WebStorm** (same path mapping `/app` → `$PROJECT_DIR$/vendor/opencode-veritly`):

- OpenCode: `http://opencode-veritly-production-4a4e.up.railway.app:9229`
- sdk-relay: `http://debug-veritly-9230.veritly.co.uk:9230`
- edge: `http://debug-veritly-9231.veritly.co.uk:9231`

Matching run configurations (localhost variants unchanged): `Veritly production OpenCode inspect 9229`, `Veritly production sdk-relay inspect 9230`, `Veritly production edge inspect 9231` under `.idea/runConfigurations/`.
