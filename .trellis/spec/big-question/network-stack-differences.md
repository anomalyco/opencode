# Network Stack Differences: Node fetch vs Electron net.fetch

> **Severity**: P1 - Network requests fail in main process

## Problem

Main process HTTP requests fail with `fetch failed`, but the same URL works in the browser (renderer process) and in the system browser.

```typescript
// Main process
const response = await fetch('https://api.example.com/endpoint');
// Error: fetch failed

// Same URL in browser window - works fine!
```

Error logs show generic failures:

```
Token exchange error {"error":"fetch failed"}
```

## Symptoms

- Browser-based flows work (OAuth login, web pages)
- Main process `fetch()` fails silently or times out
- `curl` from terminal also fails/times out
- Problem appears on machines with VPN/proxy

## Root Cause

Node.js `fetch()` and Electron/Chromium's network stack are **completely different implementations**:

| Feature              | Node `fetch()`         | Electron `net.fetch()` |
| -------------------- | ---------------------- | ---------------------- |
| Network stack        | Node's libuv           | Chromium               |
| System proxy         | **Ignored by default** | Respected              |
| VPN routing          | May not follow         | Follows system         |
| Certificate handling | Node CA store          | System CA store        |

When your machine has:

- Corporate proxy
- VPN
- Custom network configuration

Node's `fetch()` doesn't automatically pick these up, while the browser does.

## Diagnosing the Issue

1. **Browser works, Node doesn't**
   - Browser OAuth/login succeeds
   - Main process API call fails

2. **curl fails too**

   ```bash
   curl -v https://api.example.com/endpoint
   # Timeout or connection refused
   ```

3. **Proxy/VPN in environment**
   ```bash
   echo $HTTP_PROXY
   echo $HTTPS_PROXY
   # If these are set, Node fetch may not use them
   ```

## Solution

Use Electron's `net.fetch()` instead of Node's `fetch()`:

```typescript
// Before (Node fetch - ignores proxy)
const response = await fetch(url, options);

// After (Electron net.fetch - uses Chromium networking)
import { net } from 'electron';

const response = await net.fetch(url, options);
```

### Full Example

```typescript
// src/main/services/api.ts
import { net } from 'electron';

export async function callApi(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = `${API_BASE_URL}${endpoint}`;

  try {
    // Use Electron's net module for Chromium networking
    const response = await net.fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers,
      body: options?.body,
    });

    return response;
  } catch (error) {
    // Provide clearer error message
    throw new Error(
      `Network request failed. ` +
        `If you're behind a proxy/VPN, ensure it's configured correctly. ` +
        `Original error: ${error}`
    );
  }
}
```

## When to Use Which

| Scenario                  | Recommendation                               |
| ------------------------- | -------------------------------------------- |
| Main process -> Internet  | `net.fetch()`                                |
| Main process -> localhost | Either works                                 |
| Renderer process          | Use normal `fetch()` (already uses Chromium) |
| Preload script            | `ipcRenderer.invoke()` to main process       |

## Key Insight

**Different network stacks in the same app can behave differently.**

In Electron apps:

- **Renderer process** uses Chromium's network stack (same as browser)
- **Main process** uses Node.js network stack (different!)

This means:

- Browser login works (Chromium)
- Token exchange in main process fails (Node)

The "aha" moment: **If it works in browser but not in main process, it's a network stack mismatch.**

## Alternative: Configure Node Proxy

If you can't use `net.fetch()`, configure Node to use proxy:

```typescript
import { HttpsProxyAgent } from 'https-proxy-agent';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

const response = await fetch(url, {
  agent, // Node-fetch or undici
  ...options,
});
```

**Note**: This requires additional packages and doesn't handle all proxy scenarios.

## Prevention

For any Electron app that makes HTTP requests from the main process:

1. Default to `net.fetch()` for external URLs
2. Document which network stack is used where
3. Test on machines with VPN/proxy early

## Related APIs

```typescript
import { net, session } from 'electron';

// Fetch with Chromium networking
net.fetch(url, options);

// Check if online
net.isOnline();

// Access session for cookies, etc.
session.defaultSession.cookies;
```
