---
name: error-tracking
description: Add Sentry v8 error tracking and performance monitoring to your project services. Use this skill when adding error handling, creating new controllers, instrumenting cron jobs, or tracking database performance. ALL ERRORS MUST BE CAPTURED TO SENTRY - no exceptions.
---

# your project Sentry Integration Skill

## Purpose
This skill enforces comprehensive Sentry error tracking and performance monitoring across all your project services following Sentry v8 patterns.

## When to Use This Skill
- Adding error handling to any code
- Creating new controllers or routes
- Instrumenting cron jobs
- Tracking database performance
- Adding performance spans
- Handling workflow errors

## 🚨 CRITICAL RULE

**ALL ERRORS MUST BE CAPTURED TO SENTRY** - No exceptions. Never use console.error alone.

## Current Status

### Form Service ✅ Complete
- Sentry v8 fully integrated
- All workflow errors tracked
- SystemActionQueueProcessor instrumented
- Test endpoints available

### Email Service 🟡 In Progress
- Phase 1-2 complete (6/22 tasks)
- 189 ErrorLogger.log() calls remaining

## Sentry Integration Patterns

### 1. Controller Error Handling

```typescript
// ✅ CORRECT - Use BaseController
import { BaseController } from '../controllers/BaseController';

export class MyController extends BaseController {
    async myMethod() {
        try {
            // ... your code
        } catch (error) {
            this.handleError(error, 'myMethod'); // Automatically sends to Sentry
        }
    }
}
```

### 2. Route Error Handling (Without BaseController)

```typescript
import * as Sentry from '@sentry/node';

router.get('/route', async (req, res) => {
    try {
        // ... your code
    } catch (error) {
        Sentry.captureException(error, {
            tags: { route: '/route', method: 'GET' },
            extra: { userId: req.user?.id }
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});
```

### 3. Workflow Error Handling

```typescript
import { WorkflowSentryHelper } from '../workflow/utils/sentryHelper';

// ✅ CORRECT - Use WorkflowSentryHelper
WorkflowSentryHelper.captureWorkflowError(error, {
    workflowCode: 'DHS_CLOSEOUT',
    instanceId: 123,
    stepId: 456,
    userId: 'user-123',
    operation: 'stepCompletion',
    metadata: { additionalInfo: 'value' }
});
```

### 4. Cron Jobs (MANDATORY Pattern)

```typescript
#!/usr/bin/env node
// FIRST LINE after shebang - CRITICAL!
import '../instrument';
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
            // Your cron job logic
        } catch (error) {
            Sentry.captureException(error, {
                tags: {
                    'cron.job': 'job-name',
                    'error.type': 'execution_error'
                }
            });
            console.error('[Job] Error:', error);
            process.exit(1);
        }
    });
}

main()
    .then(() => {
        console.log('[Job] Completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[Job] Fatal error:', error);
        process.exit(1);
    });
```

### 5. Database Performance Monitoring

```typescript
import { DatabasePerformanceMonitor } from '../utils/databasePerformance';

// ✅ CORRECT - Wrap database operations
const result = await DatabasePerformanceMonitor.withPerformanceTracking(
    'findMany',
    'UserProfile',
    async () => {
        return await PrismaService.main.userProfile.findMany({
            take: 5,
        });
    }
);
```

### 6. Async Operations with Spans

```typescript
import * as Sentry from '@sentry/node';

const result = await Sentry.startSpan({
    name: 'operation.name',
    op: 'operation.type',
    attributes: {
        'custom.attribute': 'value'
    }
}, async () => {
    // Your async operation
    return await someAsyncOperation();
});
```

## Error Levels

Use appropriate severity levels:

- **fatal**: System is unusable (database down, critical service failure)
- **error**: Operation failed, needs immediate attention
- **warning**: Recoverable issues, degraded performance
- **info**: Informational messages, successful operations
- **debug**: Detailed debugging information (dev only)

## Required Context

```typescript
import * as Sentry from '@sentry/node';

Sentry.withScope((scope) => {
    // ALWAYS include these if available
    scope.setUser({ id: userId });
    scope.setTag('service', 'form'); // or 'email', 'users', etc.
    scope.setTag('environment', process.env.NODE_ENV);

    // Add operation-specific context
    scope.setContext('operation', {
        type: 'workflow.start',
        workflowCode: 'DHS_CLOSEOUT',
        entityId: 123
    });

    Sentry.captureException(error);
});
```

## Service-Specific Integration

### Form Service

**Location**: `./blog-api/src/instrument.ts`

```typescript
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
        nodeProfilingIntegration(),
    ],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
});
```

**Key Helpers**:
- `WorkflowSentryHelper` - Workflow-specific errors
- `DatabasePerformanceMonitor` - DB query tracking
- `BaseController` - Controller error handling

### Email Service

**Location**: `./notifications/src/instrument.ts`

```typescript
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
        nodeProfilingIntegration(),
    ],
    tracesSampleRate: 0.1,
    profilesSampleRate: 0.1,
});
```

**Key Helpers**:
- `EmailSentryHelper` - Email-specific errors
- `BaseController` - Controller error handling

## Configuration (config.ini)

```ini
[sentry]
dsn = your-sentry-dsn
environment = development
tracesSampleRate = 0.1
profilesSampleRate = 0.1

[databaseMonitoring]
enableDbTracing = true
slowQueryThreshold = 100
logDbQueries = false
dbErrorCapture = true
enableN1Detection = true
```

## Testing Sentry Integration

### Form Service Test Endpoints

```bash
# Test basic error capture
curl http://localhost:3002/blog-api/api/sentry/test-error

# Test workflow error
curl http://localhost:3002/blog-api/api/sentry/test-workflow-error

# Test database performance
curl http://localhost:3002/blog-api/api/sentry/test-database-performance

# Test error boundary
curl http://localhost:3002/blog-api/api/sentry/test-error-boundary
```

### Email Service Test Endpoints

```bash
# Test basic error capture
curl http://localhost:3003/notifications/api/sentry/test-error

# Test email-specific error
curl http://localhost:3003/notifications/api/sentry/test-email-error

# Test performance tracking
curl http://localhost:3003/notifications/api/sentry/test-performance
```

## Performance Monitoring

### Requirements

1. **All API endpoints** must have transaction tracking
2. **Database queries > 100ms** are automatically flagged
3. **N+1 queries** are detected and reported
4. **Cron jobs** must track execution time

### Transaction Tracking

```typescript
import * as Sentry from '@sentry/node';

// Automatic transaction tracking for Express routes
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());

// Manual transaction for custom operations
const transaction = Sentry.startTransaction({
    op: 'operation.type',
    name: 'Operation Name',
});

try {
    // Your operation
} finally {
    transaction.finish();
}
```

## Common Mistakes to Avoid

❌ **NEVER** use console.error without Sentry
❌ **NEVER** swallow errors silently
❌ **NEVER** expose sensitive data in error context
❌ **NEVER** use generic error messages without context
❌ **NEVER** skip error handling in async operations
❌ **NEVER** forget to import instrument.ts as first line in cron jobs

## Implementation Checklist

When adding Sentry to new code:

- [ ] Imported Sentry or appropriate helper
- [ ] All try/catch blocks capture to Sentry
- [ ] Added meaningful context to errors
- [ ] Used appropriate error level
- [ ] No sensitive data in error messages
- [ ] Added performance tracking for slow operations
- [ ] Tested error handling paths
- [ ] For cron jobs: instrument.ts imported first

## Key Files

### Form Service
- `/blog-api/src/instrument.ts` - Sentry initialization
- `/blog-api/src/workflow/utils/sentryHelper.ts` - Workflow errors
- `/blog-api/src/utils/databasePerformance.ts` - DB monitoring
- `/blog-api/src/controllers/BaseController.ts` - Controller base

### Email Service
- `/notifications/src/instrument.ts` - Sentry initialization
- `/notifications/src/utils/EmailSentryHelper.ts` - Email errors
- `/notifications/src/controllers/BaseController.ts` - Controller base

### Configuration
- `/blog-api/config.ini` - Form service config
- `/notifications/config.ini` - Email service config
- `/sentry.ini` - Shared Sentry config

## Documentation

- Full implementation: `/dev/active/email-sentry-integration/`
- Form service docs: `/blog-api/docs/sentry-integration.md`
- Email service docs: `/notifications/docs/sentry-integration.md`

## Related Skills

- Use **database-verification** before database operations
- Use **workflow-builder** for workflow error context
- Use **database-scripts** for database error handling
