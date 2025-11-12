# Sentry Integration and Monitoring

Complete guide to error tracking and performance monitoring with Sentry v8.

## Table of Contents

- [Core Principles](#core-principles)
- [Sentry Initialization](#sentry-initialization)
- [Error Capture Patterns](#error-capture-patterns)
- [Performance Monitoring](#performance-monitoring)
- [Cron Job Monitoring](#cron-job-monitoring)
- [Error Context Best Practices](#error-context-best-practices)
- [Common Mistakes](#common-mistakes)

---

## Core Principles

**MANDATORY**: All errors MUST be captured to Sentry. No exceptions.

**ALL ERRORS MUST BE CAPTURED** - Use Sentry v8 with comprehensive error tracking across all services.

---

## Sentry Initialization

### instrument.ts Pattern

**Location:** `src/instrument.ts` (MUST be first import in server.ts and all cron jobs)

**Template for Microservices:**

```typescript
import * as Sentry from '@sentry/node';
import * as fs from 'fs';
import * as path from 'path';
import * as ini from 'ini';

const sentryConfigPath = path.join(__dirname, '../sentry.ini');
const sentryConfig = ini.parse(fs.readFileSync(sentryConfigPath, 'utf-8'));

Sentry.init({
    dsn: sentryConfig.sentry?.dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(sentryConfig.sentry?.tracesSampleRate || '0.1'),
    profilesSampleRate: parseFloat(sentryConfig.sentry?.profilesSampleRate || '0.1'),

    integrations: [
        ...Sentry.getDefaultIntegrations({}),
        Sentry.extraErrorDataIntegration({ depth: 5 }),
        Sentry.localVariablesIntegration(),
        Sentry.requestDataIntegration({
            include: {
                cookies: false,
                data: true,
                headers: true,
                ip: true,
                query_string: true,
                url: true,
                user: { id: true, email: true, username: true },
            },
        }),
        Sentry.consoleIntegration(),
        Sentry.contextLinesIntegration(),
        Sentry.prismaIntegration(),
    ],

    beforeSend(event, hint) {
        // Filter health checks
        if (event.request?.url?.includes('/healthcheck')) {
            return null;
        }

        // Scrub sensitive headers
        if (event.request?.headers) {
            delete event.request.headers['authorization'];
            delete event.request.headers['cookie'];
        }

        // Mask emails for PII
        if (event.user?.email) {
            event.user.email = event.user.email.replace(/^(.{2}).*(@.*)$/, '$1***$2');
        }

        return event;
    },

    ignoreErrors: [
        /^Invalid JWT/,
        /^JWT expired/,
        'NetworkError',
    ],
});

// Set service context
Sentry.setTags({
    service: 'form',
    version: '1.0.1',
});

Sentry.setContext('runtime', {
    node_version: process.version,
    platform: process.platform,
});
```

**Critical Points:**
- PII protection built-in (beforeSend)
- Filter non-critical errors
- Comprehensive integrations
- Prisma instrumentation
- Service-specific tagging

---

## Error Capture Patterns

### 1. BaseController Pattern

```typescript
// Use BaseController.handleError
protected handleError(error: unknown, res: Response, context: string, statusCode = 500): void {
    Sentry.withScope((scope) => {
        scope.setTag('controller', this.constructor.name);
        scope.setTag('operation', context);
        scope.setUser({ id: res.locals?.claims?.userId });
        Sentry.captureException(error);
    });

    res.status(statusCode).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Error occurred' }
    });
}
```

### 2. Workflow Error Handling

```typescript
import { SentryHelper } from '../utils/sentryHelper';

try {
    await businessOperation();
} catch (error) {
    SentryHelper.captureOperationError(error, {
        operationType: 'POST_CREATION',
        entityId: 123,
        userId: 'user-123',
        operation: 'createPost',
    });
    throw error;
}
```

### 3. Service Layer Error Handling

```typescript
try {
    await someOperation();
} catch (error) {
    Sentry.captureException(error, {
        tags: {
            service: 'form',
            operation: 'someOperation'
        },
        extra: {
            userId: currentUser.id,
            entityId: 123
        }
    });
    throw error;
}
```

---

## Performance Monitoring

### Database Performance Tracking

```typescript
import { DatabasePerformanceMonitor } from '../utils/databasePerformance';

const result = await DatabasePerformanceMonitor.withPerformanceTracking(
    'findMany',
    'UserProfile',
    async () => {
        return await PrismaService.main.userProfile.findMany({ take: 5 });
    }
);
```

### API Endpoint Spans

```typescript
router.post('/operation', async (req, res) => {
    return await Sentry.startSpan({
        name: 'operation.execute',
        op: 'http.server',
        attributes: {
            'http.method': 'POST',
            'http.route': '/operation'
        }
    }, async () => {
        const result = await performOperation();
        res.json(result);
    });
});
```

---

## Cron Job Monitoring

### Mandatory Pattern

```typescript
#!/usr/bin/env node
import '../instrument'; // FIRST LINE after shebang
import * as Sentry from '@sentry/node';

async function main() {
    return await Sentry.startSpan({
        name: 'cron.job-name',
        op: 'cron',
        attributes: {
            'cron.job': 'job-name',
            'cron.startTime': new Date().toISOString(),
        }
    }, async () => {
        try {
            // Cron job logic here
        } catch (error) {
            Sentry.captureException(error, {
                tags: {
                    'cron.job': 'job-name',
                    'error.type': 'execution_error'
                }
            });
            console.error('[Cron] Error:', error);
            process.exit(1);
        }
    });
}

main().then(() => {
    console.log('[Cron] Completed successfully');
    process.exit(0);
}).catch((error) => {
    console.error('[Cron] Fatal error:', error);
    process.exit(1);
});
```

---

## Error Context Best Practices

### Rich Context Example

```typescript
Sentry.withScope((scope) => {
    // User context
    scope.setUser({
        id: user.id,
        email: user.email,
        username: user.username
    });

    // Tags for filtering
    scope.setTag('service', 'form');
    scope.setTag('endpoint', req.path);
    scope.setTag('method', req.method);

    // Structured context
    scope.setContext('operation', {
        type: 'workflow.complete',
        workflowId: 123,
        stepId: 456
    });

    // Breadcrumbs for timeline
    scope.addBreadcrumb({
        category: 'workflow',
        message: 'Starting step completion',
        level: 'info',
        data: { stepId: 456 }
    });

    Sentry.captureException(error);
});
```

---

## Common Mistakes

```typescript
// ❌ Swallowing errors
try {
    await riskyOperation();
} catch (error) {
    // Silent failure
}

// ❌ Generic error messages
throw new Error('Error occurred');

// ❌ Exposing sensitive data
Sentry.captureException(error, {
    extra: { password: user.password } // NEVER
});

// ❌ Missing async error handling
async function bad() {
    fetchData().then(data => processResult(data)); // Unhandled
}

// ✅ Proper async handling
async function good() {
    try {
        const data = await fetchData();
        processResult(data);
    } catch (error) {
        Sentry.captureException(error);
        throw error;
    }
}
```

---

**Related Files:**
- [SKILL.md](SKILL.md)
- [routing-and-controllers.md](routing-and-controllers.md)
- [async-and-errors.md](async-and-errors.md)
