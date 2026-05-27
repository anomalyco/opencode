# Deploying unleashlive/opencode collab on AWS ECS

> **Before deploying**, read [`docs/adr/README.md`](docs/adr/README.md).  ADRs
> 0001–0005 cover security gaps in the configuration described below; ADRs
> 0006–0009 cover operational improvements (background GC, health checks,
> single-replica contract).  The steps below remain the deployment recipe;
> the ADRs are the open work items that must close before this is production-
> safe.
>
> **Default branch + CI**: this fork's default branch is **`collab`** (was
> `dev` until 2026-05-25).  Active CI is intentionally narrow — only
> `test.yml`, `typecheck.yml`, and `deploy-collab.yml` live in
> `.github/workflows/`.  The 26 upstream sst/opencode workflows (npm
> publishing, docs translation, Nix eval, VSCode/Zed extension publishing,
> upstream community automation, etc.) have been purged.  See the
> [CI Surface](#ci-surface) section below.
>
> **Existing clones** need a one-time HEAD update after the default-branch
> flip:
> ```sh
> git fetch origin
> git remote set-head origin -a    # updates origin/HEAD → origin/collab
> ```
> New clones pick up `collab` automatically.
>
> **Utils dev deployment (`https://collab.utils.unleashlive.com`) is
> automated via Terragrunt + GitHub Actions.**  See the runbook at
> [`unleashlive/devops/terraform/opencode-collab/README.md`](https://github.com/unleashlive/devops/blob/master/terraform/opencode-collab/README.md)
> for the bootstrap recipe, plus `.github/workflows/deploy-collab.yml` in
> this repo for the deploy button (`workflow_dispatch` only — no auto-deploy
> on push).  The walkthrough below is the prod-oriented narrative; it still
> describes the same shape (ECS Fargate + ALB + EFS + Secrets Manager).
>
> **GH Actions repository secret required**: `AWS_UTILS_ACCOUNT_ID = 637226132752`.
>
> **Auth model (utils deployment)**: `OPENCODE_AUTH_MODE=collab` is set; the
> GitHub OAuth cookie is the **sole** auth gate.  Basic auth
> (`OPENCODE_SERVER_PASSWORD`) is OFF.  Unauthenticated HTML navigations 302 to
> `/collab/auth/github?next=<path>`; XHR / fetch get `401 JSON` (no browser
> dialog).  Only members of `GITHUB_ORG_NAME` can complete the OAuth callback.
> Iframe access additionally requires the collab session to have at least one
> linked repository — the SPA's `/collab/<id>` page renders a recovery panel
> with an "Add repositories" form if none were selected at create time.

This document walks an operator through standing up the collab fork behind
`https://collab.unleashlive.com` on AWS ECS, plus answers two recurring
questions from the team:

1. *"How do collab users see the running code? Locally I'd use `localhost:3000`."*
2. *"Step-by-step: how do I launch the site, start the first session, and supply Claude credentials?"*

---

## Codebase audit (what the deployment actually needs)

The current Dockerfile + docker-compose is small enough that ECS is mostly
configuration, not rebuilding:

- **One port**: container listens on `4096` only (`Dockerfile` line 102, `docker-compose.yml` line 7).  No dev-server preview ports exposed today.
- **Two persistent paths**:
  - `/root/.local/share/opencode` → SQLite, low MB
  - `/var/opencode/workspaces` → git clones, can grow to GB
- **`OPENCODE_BASE_URL` is read at runtime** (`packages/opencode/src/collab/router.ts` line 311) — not baked into the bundle.  Changing host doesn't require a rebuild.
- **Claude credentials** are bind-mounted from `~/.claude/.credentials.json` on the host.  Fargate has no host to bind-mount from; the production path uses a real Anthropic API key instead (see Part C).

---

## Part A — How collab users see code, diffs, and a running app

### What they already see for free

The opencode iframe inside `/collab/<id>` already gives every participant:

- **The repo file tree** rooted at the workspace path — same files for everyone
- **Real-time git diff / review pane** that updates as the LLM edits files
- `git status` / `git log` / `git diff` in the iframe's terminal panel
- The full LLM conversation timeline showing every tool call (file reads, writes, shell commands)

So for code / commits / diffs there's nothing to build — the iframe is already the shared view.

### Previewing a dev server (the `localhost:3000` muscle-memory question)

When the LLM runs `npm run dev` (or `bun run dev`, Vite, Next, etc.) inside the workspace, the dev server binds to `localhost:3000` *inside the container's network namespace*.  Today nothing exposes that to participants' browsers — there are no proxies, no port forwarders, no preview routes (verified by grepping `packages/opencode/src/server/*` and `packages/opencode/src/pty/*`).

**MVP recommendation: ship without dev-server preview in v1; add it in v2.**

Three options ranked:

| Option | How it works | Effort | Trade-off |
|---|---|---|---|
| **A. Path-based reverse proxy (recommended for v2)** | Add a small Bun proxy inside the container that listens on `4096`'s collab router for `/preview/<port>/*`, strips the prefix, proxies HTTP + WebSockets to `127.0.0.1:<port>`.  Users open `https://collab.unleashlive.com/preview/3000/`. | ~150 LOC inside `packages/opencode/src/collab/router.ts` (or a sibling preview-router file).  No infra change — same ALB, same single port. | Apps using absolute paths need a `--base=/preview/3000/` flag.  Vite HMR works once you set `server.hmr.clientPort=443`. |
| B. Multi-port ALB | Add ECS port mappings for 3000/5173/8080, ALB listeners on `:3001`/`:5174`/`:8081`, target groups per port. | Pure infra; no code change. | Custom ports break corporate firewalls; multiple ACM cert renewals; security-group hassle. |
| C. ngrok / cloudflared sidecar | Each session spins up a tunnel; URL embedded in the UI. | Low code; external SaaS dependency. | URL rotates; rate limits; not enterprise-friendly. |

For v1 we defer this entirely.  Until `/preview/*` lands, the workaround is to `git push` to a PR branch and have a reviewer pull + run locally.

---

## Part B — Deploy to AWS ECS at `collab.unleashlive.com`

### Prerequisites on your workstation

- AWS CLI v2 logged in to the **unleashlive** AWS account with admin or equivalent IAM perms
- Docker (to build + push) — Apple Silicon Macs need `--platform=linux/amd64`
- A Claude API key from <https://console.anthropic.com> (production uses the API key path; see Part C)
- The **unleashlive** GitHub org owner role (to create the OAuth App + the org-scoped PAT)

### Step 0 — GitHub OAuth App + server PAT

At `github.com/organizations/unleashlive/settings/applications/new`:

- Application name: `unleashlive collab`
- Homepage URL: `https://collab.unleashlive.com`
- Authorization callback URL: `https://collab.unleashlive.com/collab/auth/github/callback`
- Note the **Client ID** and generate a **Client Secret**

Server-side PAT at `github.com/settings/tokens` (classic):

- Scopes: `read:org`, `repo`
- Owner: an account that's a member of `unleashlive` (the PAT owns the org-membership probe)

Save both — they go into Secrets Manager next.

### Step 1 — Route 53 hosted zone + ACM cert

```bash
# Hosted zone — assumed to already exist for unleashlive.com.  If not:
aws route53 create-hosted-zone --name unleashlive.com --caller-reference $(date +%s)

# ACM cert (must be in the same region as your ALB, e.g. ap-southeast-2 for Sydney)
aws acm request-certificate \
  --domain-name collab.unleashlive.com \
  --validation-method DNS \
  --region <your-alb-region>
# Add the CNAME validation record to Route 53 (or click "Create record in Route 53" in the ACM console).
```

### Step 2 — ECR repository + push the image

```bash
ACCOUNT=<aws account id>
REGION=ap-southeast-2          # or wherever you run ECS

aws ecr create-repository --repository-name unleashlive/opencode-collab --region $REGION

aws ecr get-login-password --region $REGION \
  | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

cd /path/to/unleashlive/opencode
docker build --platform=linux/amd64 -t opencode-collab:latest .
docker tag opencode-collab:latest \
  $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/unleashlive/opencode-collab:latest
docker push \
  $ACCOUNT.dkr.ecr.$REGION.amazonaws.com/unleashlive/opencode-collab:latest
```

`--platform=linux/amd64` matters if you're building on Apple Silicon — Fargate runs x86-64 by default.

### Step 3 — Persistent storage via EFS

Two file systems (or one with two access points) so the SQLite DB stays separate from the larger workspace clones:

```bash
aws efs create-file-system --creation-token opencode-data       --region $REGION
aws efs create-file-system --creation-token collab-workspaces   --region $REGION
# Create mount targets in each subnet your ECS service runs in.
```

Access points use **uid/gid 10001** (ADR-0003 — the `opencode` user).
The exact `create-access-point` commands and the one-time chown of
existing data live in "One-time EFS migration to uid 10001" inside
Step 5 below.

Lower-spend alternative for early days: a single EC2 instance with EBS works fine — workspace dirs rarely exceed a few GB unless you clone monorepos.

### Step 4 — AWS Secrets Manager entries

```bash
aws secretsmanager create-secret --name opencode/github_oauth_client_secret --secret-string "<client secret>"
aws secretsmanager create-secret --name opencode/github_token              --secret-string "<PAT>"
aws secretsmanager create-secret --name opencode/anthropic_api_key         --secret-string "sk-ant-..."
aws secretsmanager create-secret --name opencode/session_secret            --secret-string "$(openssl rand -hex 32)"
```

`SESSION_SECRET` is load-bearing in production — it's the master key
for encrypting `collab_auth_session.github_access_token` at rest
(ADR-0004).  Rotating it intentionally invalidates every active
cookie, forcing each user to re-OAuth.  If you must rotate without a
forced sign-out, decrypt with the old secret then re-encrypt with the
new one via a SQL transaction; document the per-row format in
`packages/opencode/src/collab/crypto.ts`.

Optional: `aws secretsmanager create-secret --name opencode/openai_api_key --secret-string "..."` for OpenAI fallback.

Copy each secret's ARN for the next step.

### Step 5 — ECS task definition

Fargate, 2 vCPU / 4 GB.  Replace `<…>` placeholders with the ARNs and IDs you noted in earlier steps.

```jsonc
{
  "family": "opencode-collab",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "executionRoleArn": "<has SecretsManagerReadWrite + AmazonECSTaskExecutionRolePolicy>",
  "taskRoleArn":      "<can mount EFS>",
  "containerDefinitions": [{
    "name": "opencode",
    "image": "<acct>.dkr.ecr.<region>.amazonaws.com/unleashlive/opencode-collab:latest",
    "essential": true,
    "portMappings": [{ "containerPort": 4096, "hostPort": 4096, "protocol": "tcp" }],
    "environment": [
      { "name": "GITHUB_ORG_NAME",        "value": "unleashlive" },
      { "name": "GITHUB_OAUTH_CLIENT_ID", "value": "<client id, not a secret>" },
      { "name": "OPENCODE_BASE_URL",      "value": "https://collab.unleashlive.com" },
      { "name": "COLLAB_WORKSPACE_ROOT",  "value": "/var/opencode/workspaces" },
      { "name": "OPENCODE_LOCAL_UI_PATH", "value": "/app/packages/app/dist" },
      { "name": "OPENCODE_DISABLE_EMBEDDED_WEB_UI", "value": "true" }
    ],
    "secrets": [
      { "name": "GITHUB_OAUTH_CLIENT_SECRET", "valueFrom": "<arn of opencode/github_oauth_client_secret>" },
      { "name": "GITHUB_TOKEN",               "valueFrom": "<arn of opencode/github_token>" },
      { "name": "ANTHROPIC_API_KEY",          "valueFrom": "<arn of opencode/anthropic_api_key>" },
      { "name": "SESSION_SECRET",             "valueFrom": "<arn of opencode/session_secret>" }
    ],
    "mountPoints": [
      { "sourceVolume": "opencode-data",      "containerPath": "/home/opencode/.local/share/opencode" },
      { "sourceVolume": "collab-workspaces",  "containerPath": "/var/opencode/workspaces" }
    ],
    "linuxParameters": {
      "capabilities": { "drop": ["ALL"] }
    },
    "readonlyRootFilesystem": false,
    "user": "10001:10001",
    "healthCheck": {
      "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:4096/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""],
      "interval": 15, "timeout": 5, "retries": 5, "startPeriod": 30
    },
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group":         "/ecs/opencode-collab",
        "awslogs-region":        "<region>",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }],
  "volumes": [
    {
      "name": "opencode-data",
      "efsVolumeConfiguration": {
        "fileSystemId": "<fs-id>",
        "transitEncryption": "ENABLED",
        "authorizationConfig": { "accessPointId": "<fsap-id-data>", "iam": "ENABLED" }
      }
    },
    {
      "name": "collab-workspaces",
      "efsVolumeConfiguration": {
        "fileSystemId": "<fs-id>",
        "transitEncryption": "ENABLED",
        "authorizationConfig": { "accessPointId": "<fsap-id-workspaces>", "iam": "ENABLED" }
      }
    }
  ]
}
```

#### One-time EFS migration to uid 10001 (ADR-0003)

Existing deployments wrote EFS files as uid 0.  Before the new task
definition above is deployed, the on-disk data has to be chowned —
otherwise the new container (uid 10001) can't read its own SQLite file
or write to workspace clones.

**Step 1 — chown the existing data** with the *current* image (still
root), using an entrypoint override on a one-off ECS task:

```bash
aws ecs run-task --cluster <cluster> \
  --task-definition <current-revision> \
  --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={subnets=[...],securityGroups=[...]}' \
  --overrides '{
    "containerOverrides":[{
      "name":"opencode",
      "command":["chown","-R","10001:10001",
                 "/var/opencode/workspaces",
                 "/root/.local/share/opencode"]
    }]
  }'

# Wait for it to finish
aws ecs wait tasks-stopped --cluster <cluster> --tasks <task-arn-from-above>
```

This runs once, typically completes in under a minute.

**Step 2 — create EFS Access Points** so future writes are forced to
uid 10001 regardless of in-container uid drift:

```bash
aws efs create-access-point \
  --file-system-id <fs-id-data> \
  --posix-user 'Uid=10001,Gid=10001' \
  --root-directory 'Path=/,CreationInfo={OwnerUid=10001,OwnerGid=10001,Permissions=0755}' \
  --tags 'Key=Name,Value=opencode-data-ap'

aws efs create-access-point \
  --file-system-id <fs-id-workspaces> \
  --posix-user 'Uid=10001,Gid=10001' \
  --root-directory 'Path=/,CreationInfo={OwnerUid=10001,OwnerGid=10001,Permissions=0755}' \
  --tags 'Key=Name,Value=collab-workspaces-ap'
```

**Step 3 — IAM** — the task role needs EFS client perms on the AP ARNs:

```jsonc
{
  "Effect": "Allow",
  "Action": ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"],
  "Resource": ["<arn of fsap-data>", "<arn of fsap-workspaces>"]
}
```

`ClientRootAccess` is NOT needed after step 1; the chown is the only
operation that requires it.

**Step 4 — deploy the new task definition** (the one with `"user": "10001:10001"`).
ECS rolls it in.  If the chown was successful, the container starts;
if not, you'll see "Permission denied" errors on the SQLite open and
the task crashes — re-run step 1.

> Local docker-compose is unaffected: named volumes inherit their uid
> from the container that first writes to them; a fresh
> `docker compose up -d --build` creates `opencode-data` as uid 10001.

Key points vs. the local `docker-compose.yml`:

- `ANTHROPIC_API_KEY` is now a real API key (was `dummy` locally).  This bypasses the `opencode-claude-auth` plugin entirely — opencode sees a non-empty key and uses it directly.
- `OPENCODE_BASE_URL=https://collab.unleashlive.com` is critical — it's what builds OAuth callback URLs.
- The healthcheck command matches docker-compose.

### Step 6 — ALB + target group + ECS service

```bash
# Target group on port 4096, HTTP, health check on /
aws elbv2 create-target-group --name opencode-collab-tg --protocol HTTP --port 4096 \
  --target-type ip --vpc-id <vpc-id> --health-check-path / --region $REGION

# ALB
aws elbv2 create-load-balancer --name opencode-collab-alb --type application \
  --subnets <subnet-a> <subnet-b> --security-groups <alb-sg> --region $REGION
# Then create the listener on :443 with the ACM cert, forwarding to the target group.
# Optional: a :80 listener that redirects to :443.

# ECS service
aws ecs create-service \
  --cluster <cluster> \
  --service-name opencode-collab \
  --task-definition opencode-collab \
  --launch-type FARGATE \
  --desired-count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[<a>,<b>],securityGroups=[<task-sg>],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<tg-arn>,containerName=opencode,containerPort=4096"
```

Security groups:

- **ALB SG** — inbound `443` from `0.0.0.0/0`, outbound to task SG
- **Task SG** — inbound `4096` from ALB SG only; outbound to EFS, `443` to `github.com`, `443` to `api.anthropic.com`
- **EFS SG** — NFS (`2049`) from task SG

### Step 7 — Route 53 alias to the ALB

In the Route 53 hosted zone for `unleashlive.com`, create an A-record:

- Name: `collab`
- Alias: **Yes**
- Alias target: the ALB's DNS name (e.g. `opencode-collab-alb-1234.<region>.elb.amazonaws.com`)

DNS propagation is usually under a minute inside AWS.

### Step 8 — Smoke test

```bash
# After `aws ecs describe-services …` shows runningCount === desiredCount
curl -I https://collab.unleashlive.com
# Tail the logs while you test
aws logs tail /ecs/opencode-collab --follow --region $REGION
```

Common gotchas you'll see in the logs if anything's misconfigured:

| Log line | Meaning | Fix |
|---|---|---|
| `[collab.auth] GitHub returned an OAuth error: redirect_uri_mismatch` | OAuth App callback ≠ `OPENCODE_BASE_URL` | Fix the URL in the GitHub OAuth App |
| `[collab.auth] code exchange failed` | `GITHUB_OAUTH_CLIENT_*` env mismatch | Re-check the secret values |
| `[collab.auth] org membership denied` | User isn't a public unleashlive member, or PAT lacks `read:org` | Public the membership, or rotate the PAT |
| `[collab] failed to create native session` | Anthropic key invalid | Check `ANTHROPIC_API_KEY` secret (real `sk-ant-...`, not `dummy`) or refresh `CLAUDE_CREDENTIALS_JSON` |
| `opencode-claude-auth: Claude credentials are expired` | Claude OAuth refresh token rejected | Re-dump on a Mac (`security find-generic-password -s "Claude Code-credentials" -w`) and `put-secret-value` to `collab/claude_credentials`, then `aws ecs update-service --force-new-deployment` |
| `FATAL: no LLM auth configured in collab production` | Neither `ANTHROPIC_API_KEY` (real) nor `~/.claude/.credentials.json` present at boot | Set one of them.  The literal string `"dummy"` is treated as missing (ADR-0001 Phase 4) |

---

## Part C — First-session walkthrough (Driver)

1. Open `https://collab.unleashlive.com/collab/new` in your browser.
2. **Sign in with GitHub** — you'll be bounced through `https://github.com/login/oauth/authorize?...` and back.  Your sign-in cookie (`collab_sid`) is set on `collab.unleashlive.com` with `Path=/`, 7-day lifetime, `HttpOnly`.
3. Fill in the form:
   - **Session name** — also becomes the opencode session title
   - **Repositories** — pick from the unleashlive org list (loaded via the server-side PAT)
   - **Git branch** *(optional)* — leave blank for an auto-generated `collab/<slug>-<id>`
   - **Visibility** — *Typing indicator* (default) shows pulsing dots; *Submitted only* hides typing
   - **Prompt queue mode** — *FIFO* (Driver bypass, Contributors queue) or *Vote Pool*
   - Click **Create Collab Session**
4. The collab page loads.  The iframe on the right takes ~5–15 s to bootstrap on first hit (cloning the repo + pre-warming the opencode native session + firing the seed prompt).  You'll see *"Starting a collab session…"* as the first LLM message.
5. **Invite teammates**: click the user icon in the top-right of the left panel → pick a role (Driver / Contributor / Viewer) → **Generate invite link** → Copy → share via Slack / email.  Tokens are single-use, 72-hour expiry, org-membership-gated on redemption.
6. **Submit prompts** by typing into the editor inside the iframe — the full opencode editor with `⌘P` palette, `/` slash commands, `@` mentions, attachments, model picker.  Submissions are intercepted by the embed override and routed through the collab queue.
7. **Watch the LLM work**: every commit it produces in the workspace is auto-stamped with `Collaborative-Commit: true`, `Collab-Session:`, `Collab-Session-Id:`, `Collab-Repo:`, `Collab-Branch:` trailers via the `prepare-commit-msg` hook installed at session-init.  Verify by opening the iframe's terminal panel and running `git log -1`.
8. **Ship to GitHub** when ready: in the iframe terminal, `git push -u origin HEAD`.  The clone already has authentication baked into the remote URL via the server-side PAT, so no token entry is required from the participant.

### Provider configuration

The container is baked with a global opencode config at
`/home/opencode/.config/opencode/opencode.json`:

```json
{ "plugin": ["opencode-claude-auth@latest"], "disabled_providers": ["amazon-bedrock"] }
```

`amazon-bedrock` is disabled in this fork because:

- ap-southeast-2 Bedrock only exposes LEGACY Claude 3 / 3.5 Sonnet v2 as
  ON_DEMAND models.  Modern Claude 4.x is INFERENCE_PROFILE-only via the
  `apac.*` cross-region profile.
- opencode's bedrock region-prefix logic
  ([`packages/opencode/src/provider/provider.ts:1747-1759`](packages/opencode/src/provider/provider.ts))
  only handles `us.*` / `eu.*` regions.  `ap-*` falls back to whatever the
  sort returns first — usually `us.anthropic.claude-sonnet-4-6`, which
  doesn't exist in `ap-southeast-2` → every request errors with
  *"The provided model identifier is invalid"*.
- Bedrock is also the first provider opencode registers, so its broken
  default would beat the working Anthropic-native provider for the
  `defaultModel()` fallback.

Disabling removes the Bedrock variants from the model picker entirely and
forces all Claude traffic through the `anthropic` provider, authenticated
via the OAuth `opencode-claude-auth` plugin.  If a future deployment lives
in a Bedrock-friendly region (`us-east-1`, `eu-west-1`, etc.) you can flip
this off in the Dockerfile build.

### How Claude credentials are supplied

Three paths, ranked by suitability for a server deployment:

| | Path | When to pick |
|---|---|---|
| ✅ **Recommended (utils / dev)** | **UI upload** — any unleashlive org member visits `/collab/new`, the banner says "No Claude credentials on the server", they paste their Mac's credentials JSON into the textarea and click *Use these credentials*.  Server atomic-writes to the EFS path `/home/opencode/.local/share/opencode/claude-credentials.json` (persisted across container replacement) and symlinks `~/.claude/.credentials.json` to it so the plugin reads/writes the persistent file.  Whoever uploads last wins (container-wide, since the plugin is process-wide).  **No AWS step required.** |
| Optional pre-seed | `CLAUDE_CREDENTIALS_JSON` Secrets Manager entry, exposed as an env var.  `scripts/entrypoint.sh` writes the JSON to the EFS path on first boot only (subsequent boots skip so UI uploads aren't clobbered).  Useful for fully unattended first-boot but not required — the UI works without it. |
| For metered $ access | `ANTHROPIC_API_KEY` env var holding a real `sk-ant-...` key.  Bypasses the plugin entirely — opencode sees a non-empty key and uses it directly.  Set `manage_anthropic_api_key_secret = true` in the terraform module to opt in. |
| ❌ Don't | Set `ANTHROPIC_API_KEY=dummy` in production.  ADR-0001 Phase 4 treats `"dummy"` as missing and fail-fast aborts the boot.  The string only exists as a docker-compose placeholder for local dev where the bind-mounted plugin takes over. |

**Rotating Claude credentials** — every few weeks (when you see `opencode-claude-auth: Claude credentials are expired and could not be refreshed` in CloudWatch):

1. On a Mac with active Claude Code login:
   ```bash
   security find-generic-password -s "Claude Code-credentials" -w | pbcopy
   ```
2. Open `https://collab.utils.unleashlive.com/collab/new` in a browser.
3. Banner shows ✓ green "Claude credentials available" with the last-refreshed time.  Click *Replace* (or *Paste credentials* if it's already amber/missing).
4. Paste the clipboard contents into the textarea → *Use these credentials*.
5. Banner flips to green with the fresh `refreshed just now`.  Done — next LLM call uses the new tokens.

Rotation is now a 30-second UI flow with no AWS access required.  The Secrets Manager `CLAUDE_CREDENTIALS_JSON` path remains supported for IaC / unattended seeding but isn't on the critical path anymore.

**Bootstrapping from scratch** (no AWS, no env var):
- Deploy the ECS task with no `CLAUDE_CREDENTIALS_JSON` secret.
- `serve.ts` Phase 4 check WILL fail-fast (it requires either a real API key OR an existing creds file).  Set `ANTHROPIC_API_KEY=dummy` as a temporary placeholder OR set `OPENCODE_ALLOW_UNAUTHENTICATED=1` for the very first boot, ECS task comes up.
- Visit `/collab/new` → amber banner → paste creds → ✓.
- Remove the temporary `dummy` (set `OPENCODE_ALLOW_UNAUTHENTICATED` back to unset) on the next deploy — by then EFS has real creds, the Phase 4 check sees the file and passes.

---

## CI surface

`collab` is the integration branch.  Two workflows live in `.github/workflows/`:

| Workflow | Triggers | Jobs | Runner |
|---|---|---|---|
| `typecheck.yml` | push to `collab`, PR targeting `collab`, `workflow_dispatch` | `typecheck` (`bun typecheck`) + `parse-smoke` (`bun build --no-bundle` on the Bun runtime entry points) | `ubuntu-latest` |
| `deploy-collab.yml` | `workflow_dispatch` only | Build image + push to ECR + ECS rollout to utils account | `ubuntu-latest` |

The `parse-smoke` job is the gate that would have caught the 2026-05-27
incident: it runs `bun build --no-bundle` on `index.ts`, `server.ts`,
`collab/router.ts`, `collab/native-api.ts`, `collab/workspace.ts` and
`cli/cmd/serve.ts`.  Bun's parser is stricter than `tsgo` — it rejects
constructs like `await` outside `async function` at *load* time, which is
the failure that put the service into a CrashLoop until `f4b0f831b`
landed.  Add new runtime entry points to the `targets` array in
`typecheck.yml` if you introduce them.

The upstream sst/opencode `test.yml` (unit + e2e across a Linux + Windows
matrix on Blacksmith self-hosted runners) was deleted in the same change.
Blacksmith runners aren't configured for this fork, so every run sat in
`queued` indefinitely and gated nothing.  The unit + e2e suites also test
upstream-only paths that don't apply to the collab feature surface.
Re-introduce a targeted unit test workflow if/when there are collab-fork
tests worth gating on.

No auto-deploy on push.  Deploys are always operator-initiated:

```sh
# From a terminal (preferred):
gh workflow run deploy-collab.yml --ref collab

# Or via the GitHub Actions UI:
#   Actions → "Deploy collab" → Run workflow → leave image_tag empty
#   (defaults to "latest") → Run workflow
```

The deploy job builds the image, tags it both `latest` and
`sha-<short>`, registers a new task definition revision pointing at the
sha-tagged image, calls `update-service --force-new-deployment`, waits
for `services-stable`, and probes `/healthz`.

### Deploy mechanism — bootstrap branches deprecated

Earlier iterations of this work used temporary `deploy/*-bootstrap`
branches that carried a `push:` trigger in the workflow file to fire
deploys without a workflow file being on the default branch.  That
workaround is gone — now that `collab` is the default and carries the
workflow file, `workflow_dispatch` is sufficient.  Do not re-introduce
the push trigger; it widens the deploy surface to anyone who can push
to `deploy/*` and has no benefit over the explicit dispatch.

---

## Files referenced

| File | Why it matters for this deploy |
|---|---|
| `packages/opencode/src/collab/router.ts` line 311 | `OPENCODE_BASE_URL` consumption + OAuth callback construction |
| `packages/opencode/src/collab/workspace.ts` | Workspace dir layout that must live on EFS |
| `Dockerfile` | Already production-ready (multi-stage, plugin pre-installed, embedded UI disabled) — no changes needed for ECS |
| `docker-compose.yml` | Local-only reference; not used on ECS but the env-var list is exactly what the task definition mirrors |
| `.env.example` | Documents every env var the ECS task definition needs |

## Verification checklist

1. `curl -I https://collab.unleashlive.com` returns the SPA index (200 OK, HTML).
2. `https://collab.unleashlive.com/collab/me` returns 401 when not signed in, 200 with `{githubLogin,…}` after GitHub OAuth.
3. `/collab/new` form loads org repos (proves the PAT works).
4. Create a session, open `/collab/<id>`.  Within ~15 s the iframe shows the seed prompt + an LLM response.
5. In the terminal panel, `git commit --allow-empty -m "test" && git log -1 --format=%B` — should show the `Collaborative-Commit:` and `Collab-Session:` trailers.
6. Watch CloudWatch Logs (`/ecs/opencode-collab`) for `[collab.auth]` entries on OAuth and `[collab.typing]` entries when participants type — confirms full data flow end-to-end.
7. **Second participant**: invite a different unleashlive member, have them click the invite link in a fresh browser / incognito tab.  Their avatar's online dot should turn green on both sides within 1–2 s of SSE connect.

## Future enhancements (post-MVP)

- **Live dev-server preview** — add the `/preview/<port>/*` path-based proxy described in Part A.  ~150 LOC; no infra change.
- **Auto-scaling** — set the ECS service min/max to scale on CPU when many concurrent sessions hit one task.  SQLite-on-EFS becomes a bottleneck once you have many concurrent writers — migrate to RDS Postgres if/when that's a real problem.
- **Custom domains per session** — `cs-foo.collab.unleashlive.com` so participants can bookmark sessions cleanly.  Wildcard ACM + Route 53 alias rule.
- **Per-org tenant isolation** — currently single-tenant to `unleashlive`; add org switching for sister orgs.
