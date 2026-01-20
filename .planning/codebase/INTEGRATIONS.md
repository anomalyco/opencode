# External Integrations

**Analysis Date:** 2026-01-19

## AI/LLM Providers

**Anthropic (Claude):**
- SDK: `@ai-sdk/anthropic`
- Auth: `ANTHROPIC_API_KEY`
- Features: claude-code beta headers for extended capabilities

**OpenAI:**
- SDK: `@ai-sdk/openai`
- Auth: `OPENAI_API_KEY`
- Features: Responses API, custom model loaders

**Google (Gemini/Vertex):**
- SDK: `@ai-sdk/google`, `@ai-sdk/google-vertex`
- Auth: `GOOGLE_API_KEY`, `GOOGLE_CLOUD_PROJECT`
- Features: Vertex AI with Anthropic models via `@ai-sdk/google-vertex/anthropic`

**Amazon Bedrock:**
- SDK: `@ai-sdk/amazon-bedrock`
- Auth: AWS credentials chain or `AWS_BEARER_TOKEN_BEDROCK`
- Features: Cross-region inference, credential providers

**Azure OpenAI:**
- SDK: `@ai-sdk/azure`
- Auth: Azure credentials
- Features: Cognitive Services integration, completion URLs

**Other Providers:**
- OpenRouter (`@openrouter/ai-sdk-provider`)
- xAI/Grok (`@ai-sdk/xai`)
- Mistral (`@ai-sdk/mistral`)
- Groq (`@ai-sdk/groq`)
- DeepInfra (`@ai-sdk/deepinfra`)
- Cerebras (`@ai-sdk/cerebras`)
- Cohere (`@ai-sdk/cohere`)
- TogetherAI (`@ai-sdk/togetherai`)
- Perplexity (`@ai-sdk/perplexity`)
- Vercel AI Gateway (`@ai-sdk/vercel`)
- GitLab (`@gitlab/gitlab-ai-provider`)

**Custom Providers:**
- GitHub Copilot - Custom OpenAI-compatible SDK
- SAP AI Core - Enterprise AI integration
- Cloudflare AI Gateway - Unified billing gateway

**Model Database:**
- Fetches from `https://models.dev/api.json`
- Cached locally in `~/.opencode/cache/models.json`
- Auto-refreshes hourly

## Data Storage

**Databases:**
- PlanetScale (MySQL-compatible)
  - ORM: Drizzle ORM (`drizzle-orm/planetscale-serverless`)
  - Client: `@planetscale/database`
  - Connection: Via SST `Resource.Database.*`
  - Schemas: `packages/console/core/src/schema/*.sql.ts`

**File Storage:**
- Cloudflare R2 (S3-compatible)
  - Session sharing data
  - Enterprise storage
  - Configured via SST buckets

**Key-Value Storage:**
- Cloudflare KV
  - Auth tokens (`AuthStorage`)
  - Gateway caching (`GatewayKv`)

**Durable Objects:**
- `SyncServer` - Real-time session sync via WebSocket

## Authentication & Identity

**OpenAuth (via @openauthjs/openauth):**
- OAuth 2.0 issuer for console
- Cloudflare KV token storage
- Location: `packages/console/function/src/auth.ts`

**GitHub OAuth:**
- Console login
- Scopes: `read:user`, `user:email`
- Secrets: `GITHUB_CLIENT_ID_CONSOLE`, `GITHUB_CLIENT_SECRET_CONSOLE`

**Google OAuth (OIDC):**
- Console login
- Scopes: `openid`, `email`
- Secret: `GOOGLE_CLIENT_ID`

**GitHub App:**
- Repository access for GitHub Actions integration
- Token exchange endpoints: `/exchange_github_app_token`
- Secrets: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`

**Local Auth (CLI):**
- Stored in `~/.opencode/data/auth.json`
- Types: OAuth tokens, API keys, Well-known configs
- Location: `packages/opencode/src/auth/index.ts`

## Payments & Billing

**Stripe:**
- SDK: `stripe` (server), `@stripe/stripe-js` (client)
- Secrets: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- Features:
  - Checkout sessions
  - Billing portal
  - Webhook handling
  - Subscription management
  - Invoice generation
- Location: `packages/console/core/src/billing.ts`

**Stripe Webhooks:**
- Endpoint: `https://{domain}/stripe/webhook`
- Events: checkout, subscription, customer, invoice
- Configured via SST: `infra/console.ts`

## Email

**AWS SES:**
- Transactional email
- Credentials: `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`
- Templates: `packages/console/mail/`

**EmailOctopus:**
- Newsletter/marketing
- Secret: `EMAILOCTOPUS_API_KEY`

## Monitoring & Observability

**Honeycomb:**
- Log processing for production
- Secret: `HONEYCOMB_API_KEY`
- Worker: `packages/console/function/src/log-processor.ts`

**Cloudflare Logpush:**
- Enabled on API worker
- Tail consumers for log processing

**Logs:**
- Custom `Log` utility: `packages/opencode/src/util/log.ts`
- Structured logging with service context

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers - API, auth, console
- Cloudflare Pages/Static Sites - Web app, docs
- SST orchestrates all deployments

**SST Infrastructure:**
- `sst.config.ts` - Main config
- `infra/app.ts` - API worker, static sites
- `infra/console.ts` - Console, auth, database
- `infra/enterprise.ts` - Enterprise/Teams

**Providers:**
- `cloudflare` - Workers, R2, KV, Durable Objects
- `stripe` - Payment products/prices
- `planetscale` - Database branches

## GitHub Integration

**Octokit REST API:**
- Package: `@octokit/rest`
- Features: Repository access, PR management
- Location: `packages/opencode/src/cli/cmd/github.ts`

**Octokit GraphQL:**
- Package: `@octokit/graphql`
- Advanced queries

**GitHub App Auth:**
- Package: `@octokit/auth-app`
- JWT token creation for installations

**GitHub Actions:**
- OIDC token exchange for secure access
- Endpoints in `packages/function/src/api.ts`

## Slack Integration

**Slack Bolt:**
- Package: `@slack/bolt`
- Socket Mode enabled
- Location: `packages/slack/src/index.ts`

**Environment Variables:**
- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_APP_TOKEN`

**Features:**
- Message handling with OpenCode sessions
- Thread-based conversation tracking
- Tool update notifications

## MCP (Model Context Protocol)

**SDK:**
- Package: `@modelcontextprotocol/sdk`
- Transports: stdio, HTTP, SSE

**Features:**
- Tool execution from MCP servers
- OAuth authentication for remote servers
- Prompt and resource fetching
- Location: `packages/opencode/src/mcp/index.ts`

**Configuration:**
```json
{
  "mcp": {
    "server-name": {
      "type": "local",
      "command": ["npx", "server-binary"]
    }
  }
}
```

## LSP (Language Server Protocol)

**Client:**
- Package: `vscode-jsonrpc`
- Location: `packages/opencode/src/lsp/`

**Features:**
- Diagnostics, hover, definitions
- Configurable per-language
- Built-in server definitions

## Webhooks & Callbacks

**Incoming:**
- `/stripe/webhook` - Stripe payment events
- `/exchange_github_app_token` - GitHub OIDC token exchange
- MCP OAuth callbacks (local server)

**Outgoing:**
- Session sharing sync (`/share_sync`)
- GitHub API calls
- AI provider requests

## Environment Configuration

**Required for Development:**
- At least one AI provider API key
- Bun 1.3.5+

**Required for Production (Console):**
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
- `GITHUB_CLIENT_ID_CONSOLE`, `GITHUB_CLIENT_SECRET_CONSOLE`
- `GOOGLE_CLIENT_ID`
- `AWS_SES_ACCESS_KEY_ID`, `AWS_SES_SECRET_ACCESS_KEY`
- PlanetScale database credentials (via SST)
- Cloudflare account and API tokens

**Secrets Location:**
- SST secrets for production
- Environment variables for local development
- `auth.json` for CLI-stored credentials

---

*Integration audit: 2026-01-19*
