# Security Checklist

The most impactful changes are **security headers** (free, immediate) and **WAF rules** (free tier). Rate limiting and KV caching require paid tiers but are excellent for production.

1. **Set environment variables securely:**

```bash
  wrangler secret put API_KEY --env production
  wrangler secret put JWT_SECRET --env production
```

2. **Add security headers via Astro middleware** (`src/middleware.js`):

```javascript
      export function onRequest(context) {
        const response = await context.next()

        response.headers.set('X-Frame-Options', 'DENY')
        response.headers.set('X-Content-Type-Options', 'nosniff')
        response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
        response.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
        response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

        return response
    }

```

3. **Enable Cloudflare WAF rules in dashboard** (not wrangler):
   - Login to Cloudflare → Security → WAF
   - Enable "Cloudflare Managed Ruleset" and "OWASP Core Ruleset"

4. **Add DDoS protection:**
   - Security → Security Events → Enable "Under Attack Mode" during attacks
   - Security → Settings → Turn on "Bot Fight Mode"

5. **For API rate limiting**, use Cloudflare API Shield (paid) or implement in your worker:

```typescript
// Simple rate limit using KV
const key = `ratelimit:${context.request.cf.country || "unknown"}`
const count = (await env.CACHE.get(key)) || "0"
if (parseInt(count) > 100) return new Response("429", { status: 429 })
```

```json
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "opencode-web",
  "main": "./dist/_worker.js/index.js",
  "compatibility_date": "2025-11-01",

  // === Security Headers (add this section) ===
  "routes": [
    {
      "pattern": "/*",
      "zone_name": "j9xym.com"
    }
  ],

  // === KV/Secrets (never commit secrets) ===
  "vars": {
    // Public vars are fine here
  },
  // Use `wrangler secret put API_KEY` for secrets

  // === Rate Limiting ===
  "rules": [
    {
      "type": "http_rate_limit",
      "api_id": "YOUR_API_ID", // Get from Cloudflare dashboard
      "action": "block",
      "match": {
        "request": {
          "url_pattern": "/api/*",
          "methods": ["POST"]
        }
      },
      "parameters": {
        "period": 60,
        "requests_per_period": 100
      }
    }
  ],

  // === Environment-specific security ===
  "env": {
    "production": {
      // Existing production vars...

      // === Turn on security features in production ===
      "placement": { "mode": "smart" }, // Keep close to users

      // === Bind to Cloudflare WAF managed ruleset ===
      "waf": {
        "enabled": true,
        "managed_rulesets": ["cloudflare_managed_ruleset"]
      }
    }
  },

  // === D1 Database (if you add one) ===
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "opencode-db",
      "database_id": "YOUR_DB_ID"
    }
  ],

  // === KV for caching (adds resilience against DDoS) ===
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "YOUR_KV_ID"
    }
  ]
}
```
