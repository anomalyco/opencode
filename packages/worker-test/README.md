# Worker Custom Domain & Routing Test Package

This package demonstrates and verifies the relationship between Cloudflare Worker custom domains and worker routing patterns.

## Overview

This test worker provides endpoints to help you understand and verify:

- How custom domains route to workers
- How routing patterns work with different domain configurations
- How Cloudflare headers propagate through custom domain requests
- Validation of domain-based routing behavior

## Architecture

The worker uses **Hono** as the web framework and provides several key endpoints for testing domain and routing behavior.

### Key Features

1. **Domain Detection**: Detects whether a request comes through a custom domain
2. **Route Pattern Testing**: Tests Cloudflare's route pattern matching (`/api/*`)
3. **Header Inspection**: Shows all Cloudflare-provided headers
4. **Request Validation**: Validates incoming requests with Zod schemas
5. **Multi-Environment Support**: Configured for dev, staging, and production

## Project Structure

```
packages/worker-test/
├── src/
│   └── index.ts          # Main worker code with routing logic
│   └── test.ts           # Comprehensive test suite
├── package.json          # Dependencies and scripts
├── wrangler.jsonc        # Worker configuration with custom domains
├── tsconfig.json         # TypeScript configuration
└── README.md            # This file
```

## Configuration

### Custom Domains (wrangler.jsonc)

The worker is configured with custom domains:

```jsonc
{
  "routes": [
    {
      "pattern": "api.example.com",
      "custom_domain": true,
    },
    {
      "pattern": "api.test.example.com",
      "custom_domain": true,
    },
    {
      "pattern": "example.com/api/*",
      "custom_domain": false,
    },
  ],
}
```

### Environment-Specific Routing

- **Dev**: `api.dev.example.com`
- **Staging**: `api.staging.example.com`
- **Production**: `api.example.com`, `api.prod.example.com`

## API Endpoints

### 1. Root (`/`)

Returns available endpoints and usage information.

**Response:**

```json
{
  "message": "Worker Test API",
  "endpoints": {
    "/": "This help page",
    "/health": "Health check endpoint",
    "/domain-info": "Get domain and routing information",
    "/echo": "Echo back request details",
    "/test": "Test endpoint with validation"
  }
}
```

### 2. Health Check (`/health`)

Simple health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": "development"
}
```

### 3. Domain Info (`/domain-info`)

**Key endpoint for testing custom domains.** Returns detailed information about the incoming request, including domain detection and Cloudflare headers.

**Response:**

```json
{
  "request": {
    "url": "https://api.example.com/domain-info",
    "hostname": "api.example.com",
    "path": "/domain-info",
    "method": "GET",
    "headers": { ... }
  },
  "cloudflare": {
    "cf": {
      "CF-Connecting-IP": "1.2.3.4",
      "CF-Worker-Custom-Domain": "true",
      "CF-Ray": "ray-id",
      "CF-IPCountry": "US",
      "CF-Request-ID": "request-id"
    }
  },
  "routing": {
    "isCustomDomain": true,
    "hostname": "api.example.com",
    "path": "/domain-info"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 4. Echo (`/echo`)

Echoes back the request body. Useful for testing POST requests.

**Request:**

```json
{
  "test": "data",
  "number": 123
}
```

**Response:**

```json
{
  "received": { "test": "data", "number": 123 },
  "timestamp": "2024-01-01T00:00:00.000Z",
  "hostname": "api.example.com"
}
```

### 5. Test with Validation (`/test`)

Validates incoming requests using Zod schemas.

**Valid Request:**

```json
POST /test
{
  "message": "Hello World"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Hello World",
  "validated": true,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 6. API Route Pattern (`/api/*`)

Matches any path starting with `/api/`.

**Response:**

```json
{
  "message": "API route matched",
  "path": "/api/v1/users/123",
  "pattern": "/api/*",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Development

### Prerequisites

- Node.js 18+ or Bun
- Cloudflare account with Workers enabled

### Installation

```bash
# Install dependencies
bun install

# Generate TypeScript types from wrangler config
bun run generate-types
```

### Local Development

```bash
# Start local development server
bun run dev
```

This will start Wrangler in dev mode, typically at `http://localhost:8787`.

### Running Tests

```bash
# Run the test suite
bun test src/test.ts
```

The test suite includes:

- Domain detection tests
- Route pattern matching tests
- Request validation tests
- Multiple domain simulation tests
- Header propagation tests

### Type Checking

```bash
# Generate types and check TypeScript
bun run typecheck
```

### Deployment

```bash
# Deploy to Cloudflare Workers
bun run deploy
```

## Testing Custom Domain Routing

### Manual Testing

1. **Test with custom domain:**

   ```bash
   curl https://api.example.com/domain-info
   ```

2. **Verify custom domain detection:**

   ```bash
   curl https://api.example.com/domain-info | jq '.routing.isCustomDomain'
   # Should return: true
   ```

3. **Test route pattern matching:**

   ```bash
   curl https://api.example.com/api/v1/users/123
   ```

4. **Test with different hostnames:**

   ```bash
   # Via custom domain
   curl -H "Host: api.example.com" http://localhost:8787/domain-info

   # Via standard domain
   curl -H "Host: example.com" http://localhost:8787/domain-info
   ```

### Automated Testing

Run the comprehensive test suite:

```bash
bun test src/test.ts
```

The tests verify:

- ✅ Custom domain detection via `CF-Worker-Custom-Domain` header
- ✅ Route pattern matching for `/api/*`
- ✅ Request validation with Zod
- ✅ Multiple hostname handling
- ✅ Cloudflare header propagation
- ✅ 404 handling for unknown routes

## Cloudflare Headers

When a request comes through a custom domain, Cloudflare adds these headers:

| Header                    | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `CF-Worker-Custom-Domain` | `"true"` if request came through custom domain |
| `CF-Connecting-IP`        | Client's IP address                            |
| `CF-Ray`                  | Cloudflare Ray ID for request tracing          |
| `CF-IPCountry`            | Country code of the client                     |
| `CF-Request-ID`           | Unique request identifier                      |

## Environment Variables

Create a `.env` file for local development:

```bash
# .env
CF_ENV=development
```

## Troubleshooting

### Custom Domain Not Working

1. **Check wrangler.jsonc configuration:**
   - Ensure `custom_domain: true` is set
   - Verify the domain pattern matches your configured domain

2. **Verify DNS settings:**
   - Custom domains must be added in Cloudflare dashboard
   - DNS records must point to your worker

3. **Check deployment:**
   - Run `bun run deploy` to deploy the latest changes
   - Verify deployment status in Cloudflare dashboard

### Route Pattern Not Matching

1. **Pattern syntax:**
   - Use `example.com/api/*` for path-based routing
   - Use `api.example.com` for domain-based routing

2. **Test locally:**
   ```bash
   curl http://localhost:8787/api/test
   ```

### TypeScript Errors

1. **Generate types:**

   ```bash
   bun run generate-types
   ```

2. **Check types:**
   ```bash
   bun run typecheck
   ```

## Related Documentation

- [Cloudflare Workers - Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Cloudflare Workers - Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Hono Framework](https://hono.dev/)
- [Zod Validation](https://zod.dev/)

## License

MIT
