# Corporate Provider Connection Integration

This document shows how to integrate the corporate networking features into the existing provider system.

## Integration Point: `getSDK()` Function

**File**: `packages/opencode/src/provider/provider.ts` (lines 517-584)

### Modified Implementation

```typescript
async function getSDK(provider: ModelsDev.Provider, model: ModelsDev.Model) {
  const pkg = model.provider?.npm ?? provider.npm ?? provider.id
  const options = { ...s.providers[provider.id]?.options }

  // ========== NEW: Corporate networking support ==========
  const needsCorporateFetch = options["proxy"] || options["tls"]

  if (needsCorporateFetch) {
    // Use corporate-aware fetch
    const { createCorporateFetch } = await import("./corporate-fetch")

    // Determine target URL for proxy detection
    const targetUrl = options["baseURL"] ||
                     provider.api ||
                     "https://api.openai.com"

    const corporateFetch = await createCorporateFetch({
      proxy: options["proxy"] === "auto" ? "auto" :
             options["proxy"] ? {
               url: options["proxy"],
               username: options["proxyAuth"]?.username,
               password: options["proxyAuth"]?.password,
             } : false,
      tls: options["tls"],
      timeout: options["timeout"],
      interactive: true, // Enable prompts for proxy auth
      targetUrl,
    })

    // Replace with corporate fetch
    options["fetch"] = corporateFetch
  } else {
    // ========== EXISTING: Timeout-wrapped fetch ==========
    const customFetch = options["fetch"]

    options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
      const fetchFn = customFetch ?? fetch
      const opts = init ?? {}

      if (options["timeout"] !== undefined && options["timeout"] !== null) {
        const signals: AbortSignal[] = []
        if (opts.signal) signals.push(opts.signal)
        if (options["timeout"] !== false) signals.push(AbortSignal.timeout(options["timeout"]))

        const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0]
        opts.signal = combined
      }

      return fetchFn(input, {
        ...opts,
        timeout: false,
      })
    }
  }

  // Continue with SDK creation (unchanged)
  const modPath =
    provider.id === "google-vertex-anthropic"
      ? `${installedPath}/dist/anthropic/index.mjs`
      : installedPath
  const mod = await import(modPath)

  const fn = mod[Object.keys(mod).find((key) => key.startsWith("create"))!]
  const loaded = fn({
    name: provider.id,
    ...options,
  })

  s.sdk.set(key, loaded)
  return loaded as SDK
}
```

## Configuration Schema Extension

**File**: `packages/opencode/src/config/config.ts` (lines 521-541)

### Updated Schema

```typescript
const providerOptionsSchema = z.object({
  // Existing options
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  timeout: z.union([z.number(), z.literal(false)]).optional(),
  headers: z.record(z.string(), z.string()).optional(),

  // ========== NEW: Corporate networking options ==========

  // Proxy configuration
  proxy: z.union([
    z.string(), // Proxy URL or "auto"
    z.literal("auto"), // Auto-detect
    z.literal(false), // Explicitly disable
  ]).optional().describe("HTTP/HTTPS proxy URL or 'auto' for auto-detection"),

  proxyAuth: z.object({
    username: z.string().describe("Proxy username (supports {env:VAR} substitution)"),
    password: z.string().describe("Proxy password (supports {env:VAR} substitution)"),
  }).optional().describe("Proxy authentication credentials"),

  // TLS/Certificate configuration
  tls: z.object({
    ca: z.union([
      z.string(), // Single CA file path
      z.array(z.string()), // Multiple CA file paths
    ]).optional().describe("CA certificate bundle path(s) - can contain multiple certificates"),

    cert: z.string().optional().describe("Client certificate path (for mutual TLS)"),

    key: z.string().optional().describe("Client private key path"),

    rejectUnauthorized: z.boolean().optional().describe("Validate server certificates (default: true)"),
  }).optional().describe("TLS/SSL certificate configuration"),
})
```

## Usage Examples

### Example 1: Auto-detect Everything (Easiest)

```jsonc
// .opencode/config.json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "corporate-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://ai.internal.company.com/v1",
      "options": {
        "apiKey": "{env:CORPORATE_AI_KEY}",
        "baseURL": "https://ai.internal.company.com/v1",

        // Auto-detect proxy from environment/system settings
        "proxy": "auto",

        // Use corporate CA bundle (supports multiple certs!)
        "tls": {
          "ca": "/etc/ssl/certs/corporate-ca-bundle.crt"
        }
      },
      "models": {
        "gpt-4": {
          "name": "Corporate GPT-4"
        }
      }
    }
  }
}
```

**What happens:**
1. ✅ Checks `HTTPS_PROXY` environment variable
2. ✅ Checks system proxy settings (Windows registry, macOS scutil, Linux gsettings)
3. ✅ Prompts user if no proxy found but connection fails
4. ✅ Loads ALL certificates from the bundle (doesn't need to know which one!)
5. ✅ If proxy needs auth, prompts for username/password
6. ✅ Caches credentials for 1 hour

### Example 2: Explicit Proxy Configuration

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "corporate-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://ai.internal.company.com/v1",
      "options": {
        "apiKey": "{env:CORPORATE_AI_KEY}",

        // Explicit proxy URL
        "proxy": "http://proxy.company.com:8080",

        // Proxy auth from environment variables
        "proxyAuth": {
          "username": "{env:PROXY_USER}",
          "password": "{env:PROXY_PASS}"
        },

        // Multiple CA certificates
        "tls": {
          "ca": [
            "/etc/ssl/certs/root-ca.crt",
            "/etc/ssl/certs/intermediate-ca.crt",
            "/etc/ssl/certs/company-ca.crt"
          ]
        }
      }
    }
  }
}
```

### Example 3: Client Certificate (Mutual TLS)

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "high-security-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://secure-ai.company.com/v1",
      "options": {
        "apiKey": "{env:AI_KEY}",

        // Client certificate authentication
        "tls": {
          "ca": "/etc/ssl/certs/company-ca.crt",
          "cert": "/home/user/.ssl/client-cert.pem",
          "key": "/home/user/.ssl/client-key.pem"
        }
      }
    }
  }
}
```

### Example 4: Environment Variables Only (No Config)

```bash
# Set environment variables
export HTTPS_PROXY=http://proxy.company.com:8080
export PROXY_USER=john.doe
export PROXY_PASS=secret123
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/corporate-ca-bundle.crt
export CORPORATE_AI_KEY=sk-xxxxx

# Config file can be minimal
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "corporate-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "api": "https://ai.internal.company.com/v1",
      "options": {
        "apiKey": "{env:CORPORATE_AI_KEY}",
        "proxy": "auto", // Will use HTTPS_PROXY
        "tls": {
          "ca": "{env:NODE_EXTRA_CA_CERTS}" // Reuse Node convention
        }
      }
    }
  }
}
```

## Interactive Flow Example

When a user connects to a corporate endpoint:

```
$ opencode chat --provider corporate-ai

🔍 Detected proxy from environment: http://***:***@proxy.company.com:8080
📜 Loading CA certificate bundle: /etc/ssl/certs/corporate-ca-bundle.crt
   Found 3 certificates in bundle
🌐 Using proxy: http://***:***@proxy.company.com:8080

🔐 Proxy authentication required
🔑 Please enter your proxy credentials

Proxy: http://proxy.company.com:8080
? Username: john.doe
? Password: ********

✅ Proxy authentication successful

[Chat session starts...]
```

## Error Handling

### Scenario 1: Wrong Certificate

```
$ opencode chat --provider corporate-ai

📜 Loading CA certificate: /etc/ssl/certs/wrong-ca.crt
🌐 Connecting to https://ai.internal.company.com/v1...

❌ Error: self-signed certificate in certificate chain

Troubleshooting:
1. Verify you have the correct CA certificate bundle
2. Contact your IT department for the proper certificate
3. Set tls.rejectUnauthorized: false for testing (NOT recommended)
```

### Scenario 2: Proxy Authentication Failed

```
$ opencode chat --provider corporate-ai

🔐 Proxy authentication required
🔑 Please enter your proxy credentials

Proxy: http://proxy.company.com:8080
? Username: john.doe
? Password: ********

❌ Authentication failed. Please try again.

? Username: john.doe
? Password: ********

✅ Proxy authentication successful
```

### Scenario 3: No Proxy Detected (Interactive Prompt)

```
$ opencode chat --provider corporate-ai

🔍 No proxy detected. Do you need to use a proxy? (y/N) y
? Enter proxy URL: http://proxy.company.com:8080
? Does the proxy require authentication? (y/N) y
? Proxy username: john.doe
? Proxy password: ********

✅ Configuration saved for this session
```

## Dependencies to Add

```json
// packages/opencode/package.json
{
  "dependencies": {
    "undici": "^6.0.0"  // For ProxyAgent and full Node.js fetch compatibility
  }
}
```

## Testing

### Test with Public Proxy

```bash
# Use a test proxy
export HTTPS_PROXY=http://username:password@proxy-test.company.com:8080

# Test the connection
opencode chat --provider corporate-ai
```

### Test Certificate Validation

```bash
# Test with corporate CA bundle
opencode chat --provider corporate-ai

# Should work ✅

# Test without CA bundle (should fail)
opencode chat --provider corporate-ai --no-verify-ssl

# Should fail with certificate error ❌
```

## Security Considerations

1. **Credentials Storage**:
   - Proxy passwords are cached in memory (not disk)
   - Cache expires after 1 hour
   - Use environment variables for sensitive data

2. **Certificate Validation**:
   - Default is `rejectUnauthorized: true`
   - Only disable for testing/development
   - Log warnings when validation is disabled

3. **Proxy Logs**:
   - Mask credentials in all log output
   - Show `***:***@proxy.com` instead of actual credentials

## Benefits Summary

✅ **Multiple Certificates**: Just point to your CA bundle - works automatically
✅ **Auto-detection**: Reads from environment and system settings
✅ **Interactive**: Prompts for credentials when needed (like a browser)
✅ **Secure**: Credentials cached in memory, masked in logs
✅ **Standard**: Uses HTTP_PROXY, HTTPS_PROXY, NODE_EXTRA_CA_CERTS
✅ **Flexible**: Works with any AI SDK provider
✅ **Backward Compatible**: Existing configs continue to work
