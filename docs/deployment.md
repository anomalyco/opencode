# Deployment Guide

OpenCode uses a modern, serverless-first deployment architecture with SST (Serverless Stack) and Cloudflare Workers for scalability and reliability.

## Architecture Overview

```
┌─────────────────┐
│   Development   │ ← Local development
│   Environment   │
└─────────────────┘
          │
          ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   SST           │    │   Cloudflare    │    │   Edge          │
│   Framework     │    │   Workers       │    │   Deployment    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API           │    │   Web           │    │   Console       │
│   Service       │    │   Documentation │    │   Management    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Infrastructure Components

### SST Configuration (`sst.config.ts`)

```typescript
/**
 * SST configuration for OpenCode deployment
 * Defines infrastructure, providers, and deployment settings
 *
 * Key features:
 * - Multi-environment support (development, staging, production)
 * - Auto-scaling with Cloudflare Workers
 * - Durable Objects for real-time features
 * - Database migrations for schema updates
 * - Secret management for secure configuration
 */
export default $config({
  app(input) {
    return {
      name: "opencode",
      removal: input?.stage === "production" ? "retain" : "remove",
        protect: ["production"].includes(input?.stage),
        home: "cloudflare", // Deploy to Cloudflare edge network
      providers: {
        stripe: {
          apiKey: process.env.STRIPE_SECRET_KEY, // Payment processing
        },
        planetscale: "0.4.1", // Database for persistent data
        },
      },
    },
  },
  async run() {
    // Import and deploy all infrastructure components
    await import("./infra/app.js")      // Main API service
    await import("./infra/console.js")   // Management console
    await import("./infra/desktop.js")  // Desktop application
  },
  },
})
```

### API Service (`infra/app.ts`)

```typescript
/**
 * Main API Worker for OpenCode
 * Handles all HTTP requests, WebSocket connections, and real-time features
 *
 * Key responsibilities:
 * - Session management and persistence
 * - AI provider communication
 * - Tool execution coordination
 * - Real-time event streaming
 * - Authentication and authorization
 * - Error handling and logging
 */
const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID") // GitHub App authentication
const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY") // GitHub App private key
const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET") // Admin operations secret
const bucket = new sst.cloudflare.Bucket("Bucket") // File storage bucket

export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`, // e.g., api.opencode.ai
  handler: "packages/function/src/api.ts", // Main request handler

  // Enable automatic scaling based on demand
  autosalcing: {
    min: 10, // Minimum instances for responsiveness
    max: 1000, // Maximum instances to prevent cost overruns
    target: 0.7, // Target 70% CPU utilization
  },

  // Link resources for secure access and data persistence
  link: [
    bucket, // R2 storage for file uploads and session data
    GITHUB_APP_ID, // GitHub App authentication
    GITHUB_APP_PRIVATE_KEY, // GitHub App private key for webhooks
    ADMIN_SECRET, // Admin operations secret
  ],

  // Advanced worker configuration
  transform: {
    worker: (args) => {
      // Enable detailed logging for debugging and monitoring
      args.logpush = true

      // Configure Durable Objects for real-time features
      args.bindings = $resolve(args.bindings).apply((bindings) => [
        ...bindings,
        {
          name: "SYNC_SERVER", // WebSocket connection management
          type: "durable_object_namespace",
          className: "SyncServer",
        },
      ])

      // Configure database migrations for schema updates
      args.migrations = {
        // Handle version upgrades between deployments
        oldTag: $app.stage === "production" ? "" : "v1",
        newTag: $app.stage === "production" ? "" : "v1",
      }

      return args
    },
  },
})
```

### API Service (`infra/app.ts`)

```typescript
const GITHUB_APP_ID = new sst.Secret("GITHUB_APP_ID")
const GITHUB_APP_PRIVATE_KEY = new sst.Secret("GITHUB_APP_PRIVATE_KEY")
export const EMAILOCTOPUS_API_KEY = new sst.Secret("EMAILOCTOPUS_API_KEY")
const ADMIN_SECRET = new sst.Secret("ADMIN_SECRET")
const bucket = new sst.cloudflare.Bucket("Bucket")

export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`,
  handler: "packages/function/src/api.ts",
  environment: {
    WEB_DOMAIN: domain,
  },
  url: true,
  link: [bucket, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ADMIN_SECRET],
  transform: {
    worker: (args) => {
      args.logpush = true
      args.bindings = $resolve(args.bindings).apply((bindings) => [
        ...bindings,
        {
          name: "SYNC_SERVER",
          type: "durable_object_namespace",
          className: "SyncServer",
        },
      ])
      args.migrations = {
        oldTag: $app.stage === "production" ? "" : "v1",
        newTag: $app.stage === "production" ? "" : "v1",
      }
    },
  },
})
```

### Web Documentation (`infra/app.ts`)

```typescript
new sst.cloudflare.x.Astro("Web", {
  domain: "docs." + domain,
  path: "packages/web",
  environment: {
    SST_STAGE: $app.stage,
    VITE_API_URL: api.url.apply((url) => url!),
  },
})
```

### Console Management (`infra/console.ts`)

```typescript
new sst.cloudflare.x.Astro("Console", {
  domain: "console." + domain,
  path: "packages/console/app",
  environment: {
    SST_STAGE: $app.stage,
    VITE_API_URL: api.url.apply((url) => url!),
    STRIPE_PUBLISHABLE_KEY: stripe.publishableKey,
  },
})
```

## Deployment Environments

### Development

```bash
# Local development
sst dev

# With specific stage
sst dev --stage dev

# With console
sst console
```

### Staging

```bash
# Deploy to staging
sst deploy --stage staging

# With specific region
sst deploy --stage staging --region us-east-1
```

### Production

```bash
# Deploy to production
sst deploy --stage production

# With confirmation
sst deploy --stage production --yes
```

## Service Architecture

### API Worker

```typescript
// packages/function/src/api.ts
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Route handling
    if (url.pathname.startsWith("/session")) {
      return handleSessionAPI(request, env, ctx)
    }

    if (url.pathname.startsWith("/auth")) {
      return handleAuthAPI(request, env, ctx)
    }

    if (url.pathname.startsWith("/provider")) {
      return handleProviderAPI(request, env, ctx)
    }

    // Default route
    return new Response("Not Found", { status: 404 })
  },
}
```

### Durable Objects

```typescript
// Sync server for real-time features
export class SyncServer {
  constructor(state, env) {
    this.state = state
    this.env = env
  }

  async fetch(request) {
    // Handle WebSocket connections
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocket(request)
    }

    // Handle sync operations
    return this.handleSync(request)
  }

  async handleWebSocket(request) {
    const [client, server] = Object.values(new WebSocketPair())
    server.accept()

    // Store connection
    this.state.connections = this.state.connections || []
    this.state.connections.push({
      id: crypto.randomUUID(),
      ws: server,
      userId: this.getUserIdFromRequest(request),
    })

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }
}
```

### Storage Layer

```typescript
// Cloudflare R2 storage
export class StorageService {
  constructor(env) {
    this.env = env
    this.bucket = env.BUCKET
  }

  async put(key, value) {
    await this.bucket.put(key, value)
  }

  async get(key) {
    const object = await this.bucket.get(key)
    return object ? await object.text() : null
  }

  async list(prefix) {
    const list = await this.bucket.list({ prefix })
    return list.objects.map((obj) => obj.key)
  }

  async delete(key) {
    await this.bucket.delete(key)
  }
}
```

## Database Integration

### PlanetScale Integration

```typescript
// Database configuration
const database = new sst.planetscale.Database("Database", {
  region: "us-east",
  branch: "main",
})

// Usage in worker
export default {
  async fetch(request, env, ctx) {
    const connection = env.DATABASE.getConnection()

    try {
      // Query sessions
      const sessions = await connection.selectFrom("sessions").selectAll().execute()

      return Response.json(sessions)
    } finally {
      connection.close()
    }
  },
}
```

### D1 SQLite Integration

```typescript
// Cloudflare D1 for local data
const d1 = new sst.cloudflare.D1("Database", {
  region: "us-east-1",
})

// Schema migration
const migration = new sst.cloudflare.D1Migration("Migration", {
  database: d1,
  migrations: [
    {
      name: "001_initial",
      sql: `
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
      `,
    },
  ],
})
```

## CI/CD Pipeline

### GitHub Actions (`.github/workflows/deploy.yml`)

```yaml
name: Deploy

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: bun install

      - name: Run tests
        run: bun test

      - name: Deploy to staging
        if: github.ref == 'refs/heads/dev'
        run: sst deploy --stage staging
        env:
          SST_SECRET: ${{ secrets.SST_SECRET }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Deploy to production
        if: github.ref == 'refs/heads/main'
        run: sst deploy --stage production
        env:
          SST_SECRET: ${{ secrets.SST_SECRET }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### Environment Variables

```bash
# SST Configuration
export SST_SECRET="your-sst-secret"
export CLOUDFLARE_API_TOKEN="your-cloudflare-token"
export CLOUDFLARE_ACCOUNT_ID="your-account-id"

# Provider API Keys
export ANTHROPIC_API_KEY="your-anthropic-key"
export OPENAI_API_KEY="your-openai-key"
export GOOGLE_API_KEY="your-google-key"

# Stripe (for billing)
export STRIPE_SECRET_KEY="your-stripe-secret"
export STRIPE_PUBLISHABLE_KEY="your-stripe-publishable"

# Database
export PLANETSCALE_USERNAME="your-planetscale-username"
export PLANETSCALE_PASSWORD="your-planetscale-password"

# Email (for notifications)
export EMAILOCTOPUS_API_KEY="your-emailoctopus-key"
```

## Monitoring and Observability

### Cloudflare Analytics

```typescript
// Worker analytics
export default {
  async fetch(request, env, ctx) {
    const start = Date.now()

    try {
      const response = await handleRequest(request, env, ctx)

      // Log analytics
      ctx.waitUntil(
        env.ANALYTICS.writeDataPoint({
          blobs: [request.url],
          doubles: [Date.now() - start],
          indexes: [response.status],
        }),
      )

      return response
    } catch (error) {
      // Log errors
      ctx.waitUntil(
        env.ANALYTICS.writeDataPoint({
          blobs: [error.message, request.url],
          doubles: [Date.now() - start],
          indexes: ["error"],
        }),
      )

      return new Response("Internal Server Error", { status: 500 })
    }
  },
}
```

### Health Checks

```typescript
// Health check endpoint
export default {
  async fetch(request, env, ctx) {
    if (request.url.endsWith("/health")) {
      const health = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        version: env.VERSION,
        services: {
          database: await checkDatabase(env),
          storage: await checkStorage(env),
          auth: await checkAuth(env),
        },
      }

      return Response.json(health)
    }

    return handleRequest(request, env, ctx)
  },
}
```

### Error Tracking

```typescript
// Error reporting
export class ErrorReporter {
  constructor(env) {
    this.env = env
  }

  async report(error, context) {
    const errorReport = {
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      requestId: context.requestId,
    }

    // Store in error bucket
    await this.env.ERROR_BUCKET.put(`errors/${Date.now()}-${crypto.randomUUID()}.json`, JSON.stringify(errorReport))

    // Send to external service
    if (this.env.SENTRY_DSN) {
      await this.sendToSentry(errorReport)
    }
  }
}
```

## Security Configuration

### WAF Rules

```typescript
// Cloudflare WAF configuration
export const api = new sst.cloudflare.Worker("Api", {
  // ... other config
  transform: {
    worker: (args) => {
      args.waf = {
        rules: [
          {
            id: "rate-limit",
            action: "block",
            expression: 'http.request.uri.path matches "^/api/"',
            rateLimit: {
              limit: 100,
              period: 60,
            },
          },
          {
            id: "auth-required",
            action: "challenge",
            expression: 'http.request.uri.path matches "^/api/secure/"',
          },
        ],
      }
      return args
    },
  },
})
```

### CORS Configuration

```typescript
// CORS handling
export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": getAllowedOrigin(request),
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    const response = await handleRequest(request, env, ctx)

    // Add CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value)
    })

    return response
  },
}
```

## Performance Optimization

### Edge Caching

```typescript
// Cache configuration
export default {
  async fetch(request, env, ctx) {
    const cacheKey = new Request(request.url, {
      headers: { "Cache-Control": "max-age=3600" },
    })

    // Check cache
    const cached = await caches.default.match(cacheKey)
    if (cached) {
      return cached
    }

    // Generate response
    const response = await handleRequest(request, env, ctx)

    // Cache response
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()))

    return response
  },
}
```

### Image Optimization

```typescript
// OG image generation
export const imageWorker = new sst.cloudflare.Worker("ImageWorker", {
  handler: "packages/function/src/image.ts",
  bindings: {
    R2_BUCKET: bucket,
  },
})

// Image generation with caching
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const cacheKey = `og:${url.pathname}`

    // Check cache
    const cached = await env.R2_BUCKET.get(cacheKey)
    if (cached) {
      return new Response(cached.body, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      })
    }

    // Generate image
    const image = await generateOGImage(url.searchParams)

    // Cache and return
    await env.R2_BUCKET.put(cacheKey, image)

    return new Response(image, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    })
  },
}
```

## Scaling Configuration

### Auto-scaling

```typescript
// Worker auto-scaling
export const api = new sst.cloudflare.Worker("Api", {
  // ... other config
  transform: {
    worker: (args) => {
      args.autoscaling = {
        min: 10,
        max: 1000,
        target: 0.7,
      }
      return args
    },
  },
})
```

### Load Balancing

```typescript
// Geographic load balancing
export const api = new sst.cloudflare.Worker("Api", {
  domain: `api.${domain}`,
  handler: "packages/function/src/api.ts",
  transform: {
    worker: (args) => {
      args.placement = {
        mode: "smart",
        regions: ["us-east-1", "us-west-2", "eu-west-1", "ap-southeast-1"],
      }
      return args
    },
  },
})
```

## Deployment Commands

### Local Development

```bash
# Start development server
sst dev

# With specific services
sst dev --filter api
sst dev --filter web
sst dev --filter console

# With environment variables
sst dev --env-file .env.local
```

### Production Deployment

```bash
# Deploy all services
sst deploy

# Deploy specific service
sst deploy --filter api

# Deploy with rollback
sst deploy --rollback

# Deploy with confirmation
sst deploy --stage production --confirm
```

### Management Commands

```bash
# View deployment status
sst status

# View logs
sst logs

# Remove deployment
sst remove --stage production

# View secrets
sst secrets

# Add secret
sst secret set STRIPE_SECRET_KEY
```

## Troubleshooting

### Common Issues

#### Build Failures

```bash
# Clear build cache
rm -rf .sst

# Reinstall dependencies
bun install

# Check TypeScript
bun run typecheck
```

#### Deployment Failures

```bash
# Check SST configuration
sst validate

# Check Cloudflare credentials
sst whoami

# View deployment logs
sst logs --stage production
```

#### Performance Issues

```bash
# Check worker metrics
sst analytics

# View cache hit rates
sst logs --filter cache

# Monitor error rates
sst logs --filter error
```

The deployment system provides a robust, scalable infrastructure that can handle enterprise workloads while maintaining high performance and reliability.
