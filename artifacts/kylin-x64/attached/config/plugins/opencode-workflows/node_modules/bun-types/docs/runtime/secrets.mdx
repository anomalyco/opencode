---
title: Secrets
description: Use Bun's Secrets API to store and retrieve sensitive credentials securely
---

Store and retrieve sensitive credentials securely using the operating system's native credential storage APIs.

<Warning>This API is new and experimental. It may change in the future.</Warning>

```typescript index.ts icon="/icons/typescript.svg"
import { secrets } from "bun";

let githubToken: string | null = await secrets.get({
  service: "my-cli-tool",
  name: "github-token",
});

if (!githubToken) {
  githubToken = prompt("Please enter your GitHub token");

  await secrets.set({
    service: "my-cli-tool",
    name: "github-token",
    value: githubToken,
  });

  console.log("GitHub token stored");
}

const response = await fetch("https://api.github.com/user", {
  headers: { Authorization: `token ${githubToken}` },
});

console.log(`Logged in as ${(await response.json()).login}`);
```

---

## Overview

`Bun.secrets` provides a cross-platform API for managing sensitive credentials that CLI tools and development applications typically store in plaintext files like `~/.npmrc`, `~/.aws/credentials`, or `.env` files. It uses:

- **macOS**: Keychain Services
- **Linux**: libsecret (GNOME Keyring, KWallet, etc.)
- **Windows**: Windows Credential Manager

All operations are asynchronous and non-blocking, running on Bun's threadpool.

<Note>
  In the future, we may add an additional `provider` option to make this better for production deployment secrets, but
  today this API is mostly useful for local development tools.
</Note>

---

## API

### `Bun.secrets.get(options)`

Retrieve a stored credential.

```typescript
import { secrets } from "bun";

const password = await Bun.secrets.get({
  service: "my-app",
  name: "alice@example.com",
});
// Returns: string | null

// Or if you prefer without an object
const password = await Bun.secrets.get("my-app", "alice@example.com");
```

**Parameters:**

- `options.service` (string, required) - The service or application name
- `options.name` (string, required) - The username or account identifier

**Returns:**

- `Promise<string | null>` - The stored password, or `null` if not found

### `Bun.secrets.set(options, value)`

Store or update a credential.

```typescript
import { secrets } from "bun";

await secrets.set({
  service: "my-app",
  name: "alice@example.com",
  value: "super-secret-password",
});
```

**Parameters:**

- `options.service` (string, required) - The service or application name
- `options.name` (string, required) - The username or account identifier
- `value` (string, required) - The password or secret to store

**Notes:**

- If a credential already exists for the given service/name combination, it will be replaced
- The stored value is encrypted by the operating system

### `Bun.secrets.delete(options)`

Delete a stored credential.

```typescript
const deleted = await Bun.secrets.delete({
  service: "my-app",
  name: "alice@example.com",
  value: "super-secret-password",
});
// Returns: boolean
```

**Parameters:**

- `options.service` (string, required) - The service or application name
- `options.name` (string, required) - The username or account identifier

**Returns:**

- `Promise<boolean>` - `true` if a credential was deleted, `false` if not found

---

## Examples

### Storing CLI Tool Credentials

```javascript
// Store GitHub CLI token (instead of ~/.config/gh/hosts.yml)
await Bun.secrets.set({
  service: "my-app.com",
  name: "github-token",
  value: "ghp_xxxxxxxxxxxxxxxxxxxx",
});

// Or if you prefer without an object
await Bun.secrets.set("my-app.com", "github-token", "ghp_xxxxxxxxxxxxxxxxxxxx");

// Store npm registry token (instead of ~/.npmrc)
await Bun.secrets.set({
  service: "npm-registry",
  name: "https://registry.npmjs.org",
  value: "npm_xxxxxxxxxxxxxxxxxxxx",
});

// Retrieve for API calls
const token = await Bun.secrets.get({
  service: "gh-cli",
  name: "github.com",
});

if (token) {
  const response = await fetch("https://api.github.com/name", {
    headers: {
      Authorization: `token ${token}`,
    },
  });
}
```

### Migrating from Plaintext Config Files

```javascript
// Instead of storing in ~/.aws/credentials
await Bun.secrets.set({
  service: "aws-cli",
  name: "AWS_SECRET_ACCESS_KEY",
  value: process.env.AWS_SECRET_ACCESS_KEY,
});

// Instead of .env files with sensitive data
await Bun.secrets.set({
  service: "my-app",
  name: "api-key",
  value: "sk_live_xxxxxxxxxxxxxxxxxxxx",
});

// Load at runtime
const apiKey =
  (await Bun.secrets.get({
    service: "my-app",
    name: "api-key",
  })) || process.env.API_KEY; // Fallback for CI/production
```

### Error Handling

```javascript
try {
  await Bun.secrets.set({
    service: "my-app",
    name: "alice",
    value: "password123",
  });
} catch (error) {
  console.error("Failed to store credential:", error.message);
}

// Check if a credential exists
const password = await Bun.secrets.get({
  service: "my-app",
  name: "alice",
});

if (password === null) {
  console.log("No credential found");
}
```

### Updating Credentials

```javascript
// Initial password
await Bun.secrets.set({
  service: "email-server",
  name: "admin@example.com",
  value: "old-password",
});

// Update to new password
await Bun.secrets.set({
  service: "email-server",
  name: "admin@example.com",
  value: "new-password",
});

// The old password is replaced
```

---

## Platform Behavior

### macOS (Keychain)

- Credentials are stored in the name's login keychain
- The keychain may prompt for access permission on first use
- Credentials persist across system restarts
- Accessible by the name who stored them

### Linux (libsecret)

- Requires a secret service daemon (GNOME Keyring, KWallet, etc.)
- Credentials are stored in the default collection
- May prompt for unlock if the keyring is locked
- The secret service must be running

### Windows (Credential Manager)

- Credentials are stored in Windows Credential Manager
- Visible in Control Panel → Credential Manager → Windows Credentials
- Persist with `CRED_PERSIST_ENTERPRISE` flag so it's scoped per user
- Encrypted using Windows Data Protection API

## Security Considerations

1. **Encryption**: Credentials are encrypted by the operating system's credential manager
2. **Access Control**: Only the name who stored the credential can retrieve it
3. **No Plain Text**: Passwords are never stored in plain text
4. **Memory Safety**: Bun zeros out password memory after use
5. **Process Isolation**: Credentials are isolated per name account

## Limitations

- Maximum password length varies by platform (typically 2048-4096 bytes)
- Service and name names should be reasonable lengths (< 256 characters)
- Some special characters may need escaping depending on the platform
- Requires appropriate system services:
  - Linux: Secret service daemon must be running
  - macOS: Keychain Access must be available
  - Windows: Credential Manager service must be enabled

---

## Comparison with Environment Variables

Unlike environment variables, `Bun.secrets`:

- ✅ Encrypts credentials at rest (thanks to the operating system)
- ✅ Avoids exposing secrets in process memory dumps (memory is zeroed after its no longer needed)
- ✅ Survives application restarts
- ✅ Can be updated without restarting the application
- ✅ Provides name-level access control
- ❌ Requires OS credential service
- ❌ Not very useful for deployment secrets (use environment variables in production)

---

## Best Practices

1. **Use descriptive service names**: Match the tool or application name
   If you're building a CLI for external use, you probably should use a UTI (Uniform Type Identifier) for the service name.

   ```javascript
   // Good - matches the actual tool
   { service: "com.docker.hub", name: "username" }
   { service: "com.vercel.cli", name: "team-name" }

   // Avoid - too generic
   { service: "api", name: "key" }
   ```

2. **Credentials-only**: Don't store application configuration in this API
   This API is slow, you probably still need to use a config file for some things.

3. **Use for local development tools**:
   - ✅ CLI tools (gh, npm, docker, kubectl)
   - ✅ Local development servers
   - ✅ Personal API keys for testing
   - ❌ Production servers (use proper secret management)

---

## TypeScript

```typescript
namespace Bun {
  interface SecretsOptions {
    service: string;
    name: string;
  }

  interface Secrets {
    get(options: SecretsOptions): Promise<string | null>;
    set(options: SecretsOptions, value: string): Promise<void>;
    delete(options: SecretsOptions): Promise<boolean>;
  }

  const secrets: Secrets;
}
```
