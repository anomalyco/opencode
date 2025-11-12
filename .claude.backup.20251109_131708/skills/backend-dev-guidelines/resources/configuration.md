# Configuration Management - UnifiedConfig Pattern

Complete guide to managing configuration in backend microservices.

## Table of Contents

- [UnifiedConfig Overview](#unifiedconfig-overview)
- [NEVER Use process.env Directly](#never-use-processenv-directly)
- [Configuration Structure](#configuration-structure)
- [Environment-Specific Configs](#environment-specific-configs)
- [Secrets Management](#secrets-management)
- [Migration Guide](#migration-guide)

---

## UnifiedConfig Overview

### Why UnifiedConfig?

**Problems with process.env:**
- ❌ No type safety
- ❌ No validation
- ❌ Hard to test
- ❌ Scattered throughout code
- ❌ No default values
- ❌ Runtime errors for typos

**Benefits of unifiedConfig:**
- ✅ Type-safe configuration
- ✅ Single source of truth
- ✅ Validated at startup
- ✅ Easy to test with mocks
- ✅ Clear structure
- ✅ Fallback to environment variables

---

## NEVER Use process.env Directly

### The Rule

```typescript
// ❌ NEVER DO THIS
const timeout = parseInt(process.env.TIMEOUT_MS || '5000');
const dbHost = process.env.DB_HOST || 'localhost';

// ✅ ALWAYS DO THIS
import { config } from './config/unifiedConfig';
const timeout = config.timeouts.default;
const dbHost = config.database.host;
```

### Why This Matters

**Example of problems:**
```typescript
// Typo in environment variable name
const host = process.env.DB_HSOT; // undefined! No error!

// Type safety
const port = process.env.PORT; // string! Need parseInt
const timeout = parseInt(process.env.TIMEOUT); // NaN if not set!
```

**With unifiedConfig:**
```typescript
const port = config.server.port; // number, guaranteed
const timeout = config.timeouts.default; // number, with fallback
```

---

## Configuration Structure

### UnifiedConfig Interface

```typescript
export interface UnifiedConfig {
    database: {
        host: string;
        port: number;
        username: string;
        password: string;
        database: string;
    };
    server: {
        port: number;
        sessionSecret: string;
    };
    tokens: {
        jwt: string;
        inactivity: string;
        internal: string;
    };
    keycloak: {
        realm: string;
        client: string;
        baseUrl: string;
        secret: string;
    };
    aws: {
        region: string;
        emailQueueUrl: string;
        accessKeyId: string;
        secretAccessKey: string;
    };
    sentry: {
        dsn: string;
        environment: string;
        tracesSampleRate: number;
    };
    // ... more sections
}
```

### Implementation Pattern

**File:** `/blog-api/src/config/unifiedConfig.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as ini from 'ini';

const configPath = path.join(__dirname, '../../config.ini');
const iniConfig = ini.parse(fs.readFileSync(configPath, 'utf-8'));

export const config: UnifiedConfig = {
    database: {
        host: iniConfig.database?.host || process.env.DB_HOST || 'localhost',
        port: parseInt(iniConfig.database?.port || process.env.DB_PORT || '3306'),
        username: iniConfig.database?.username || process.env.DB_USER || 'root',
        password: iniConfig.database?.password || process.env.DB_PASSWORD || '',
        database: iniConfig.database?.database || process.env.DB_NAME || 'blog_dev',
    },
    server: {
        port: parseInt(iniConfig.server?.port || process.env.PORT || '3002'),
        sessionSecret: iniConfig.server?.sessionSecret || process.env.SESSION_SECRET || 'dev-secret',
    },
    // ... more configuration
};

// Validate critical config
if (!config.tokens.jwt) {
    throw new Error('JWT secret not configured!');
}
```

**Key Points:**
- Read from config.ini first
- Fallback to process.env
- Default values for development
- Validation at startup
- Type-safe access

---

## Environment-Specific Configs

### config.ini Structure

```ini
[database]
host = localhost
port = 3306
username = root
password = password1
database = blog_dev

[server]
port = 3002
sessionSecret = your-secret-here

[tokens]
jwt = your-jwt-secret
inactivity = 30m
internal = internal-api-token

[keycloak]
realm = myapp
client = myapp-client
baseUrl = http://localhost:8080
secret = keycloak-client-secret

[sentry]
dsn = https://your-sentry-dsn
environment = development
tracesSampleRate = 0.1
```

### Environment Overrides

```bash
# .env file (optional overrides)
DB_HOST=production-db.example.com
DB_PASSWORD=secure-password
PORT=80
```

**Precedence:**
1. config.ini (highest priority)
2. process.env variables
3. Hard-coded defaults (lowest priority)

---

## Secrets Management

### DO NOT Commit Secrets

```gitignore
# .gitignore
config.ini
.env
sentry.ini
*.pem
*.key
```

### Use Environment Variables in Production

```typescript
// Development: config.ini
// Production: Environment variables

export const config: UnifiedConfig = {
    database: {
        password: process.env.DB_PASSWORD || iniConfig.database?.password || '',
    },
    tokens: {
        jwt: process.env.JWT_SECRET || iniConfig.tokens?.jwt || '',
    },
};
```

---

## Migration Guide

### Find All process.env Usage

```bash
grep -r "process.env" blog-api/src/ --include="*.ts" | wc -l
```

### Migration Example

**Before:**
```typescript
// Scattered throughout code
const timeout = parseInt(process.env.OPENID_HTTP_TIMEOUT_MS || '15000');
const keycloakUrl = process.env.KEYCLOAK_BASE_URL;
const jwtSecret = process.env.JWT_SECRET;
```

**After:**
```typescript
import { config } from './config/unifiedConfig';

const timeout = config.keycloak.timeout;
const keycloakUrl = config.keycloak.baseUrl;
const jwtSecret = config.tokens.jwt;
```

**Benefits:**
- Type-safe
- Centralized
- Easy to test
- Validated at startup

---

**Related Files:**
- [SKILL.md](SKILL.md)
- [testing-guide.md](testing-guide.md)
