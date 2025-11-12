# Middleware Guide - Express Middleware Patterns

Complete guide to creating and using middleware in backend microservices.

## Table of Contents

- [Authentication Middleware](#authentication-middleware)
- [Audit Middleware with AsyncLocalStorage](#audit-middleware-with-asynclocalstorage)
- [Error Boundary Middleware](#error-boundary-middleware)
- [Validation Middleware](#validation-middleware)
- [Composable Middleware](#composable-middleware)
- [Middleware Ordering](#middleware-ordering)

---

## Authentication Middleware

### SSOMiddleware Pattern

**File:** `/form/src/middleware/SSOMiddleware.ts`

```typescript
export class SSOMiddlewareClient {
    static verifyLoginStatus(req: Request, res: Response, next: NextFunction): void {
        const token = req.cookies.refresh_token;

        if (!token) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        try {
            const decoded = jwt.verify(token, config.tokens.jwt);
            res.locals.claims = decoded;
            res.locals.effectiveUserId = decoded.sub;
            next();
        } catch (error) {
            res.status(401).json({ error: 'Invalid token' });
        }
    }
}
```

---

## Audit Middleware with AsyncLocalStorage

### Excellent Pattern from Blog API

**File:** `/form/src/middleware/auditMiddleware.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks';

export interface AuditContext {
    userId: string;
    userName?: string;
    impersonatedBy?: string;
    sessionId?: string;
    timestamp: Date;
    requestId: string;
}

export const auditContextStorage = new AsyncLocalStorage<AuditContext>();

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
    const context: AuditContext = {
        userId: res.locals.effectiveUserId || 'anonymous',
        userName: res.locals.claims?.preferred_username,
        impersonatedBy: res.locals.isImpersonating ? res.locals.originalUserId : undefined,
        timestamp: new Date(),
        requestId: req.id || uuidv4(),
    };

    auditContextStorage.run(context, () => {
        next();
    });
}

// Getter for current context
export function getAuditContext(): AuditContext | null {
    return auditContextStorage.getStore() || null;
}
```

**Benefits:**
- Context propagates through entire request
- No need to pass context through every function
- Automatically available in services, repositories
- Type-safe context access

**Usage in Services:**
```typescript
import { getAuditContext } from '../middleware/auditMiddleware';

async function someOperation() {
    const context = getAuditContext();
    console.log('Operation by:', context?.userId);
}
```

---

## Error Boundary Middleware

### Comprehensive Error Handler

**File:** `/form/src/middleware/errorBoundary.ts`

```typescript
export function errorBoundary(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    // Determine status code
    const statusCode = getStatusCodeForError(error);

    // Capture to Sentry
    Sentry.withScope((scope) => {
        scope.setLevel(statusCode >= 500 ? 'error' : 'warning');
        scope.setTag('error_type', error.name);
        scope.setContext('error_details', {
            message: error.message,
            stack: error.stack,
        });
        Sentry.captureException(error);
    });

    // User-friendly response
    res.status(statusCode).json({
        success: false,
        error: {
            message: getUserFriendlyMessage(error),
            code: error.name,
        },
        requestId: Sentry.getCurrentScope().getPropagationContext().traceId,
    });
}

// Async wrapper
export function asyncErrorWrapper(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    };
}
```

---

## Composable Middleware

### withAuthAndAudit Pattern

```typescript
export function withAuthAndAudit(...authMiddleware: any[]) {
    return [
        ...authMiddleware,
        auditMiddleware,
    ];
}

// Usage
router.post('/:formID/submit',
    ...withAuthAndAudit(SSOMiddlewareClient.verifyLoginStatus),
    async (req, res) => controller.submit(req, res)
);
```

---

## Middleware Ordering

### Critical Order (Must Follow)

```typescript
// 1. Sentry request handler (FIRST)
app.use(Sentry.Handlers.requestHandler());

// 2. Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 3. Cookie parsing
app.use(cookieParser());

// 4. Auth initialization
app.use(SSOMiddleware.initialize());

// 5. Routes registered here
app.use('/api/users', userRoutes);

// 6. Error handler (AFTER routes)
app.use(errorBoundary);

// 7. Sentry error handler (LAST)
app.use(Sentry.Handlers.errorHandler());
```

**Rule:** Error handlers MUST be registered AFTER all routes!

---

**Related Files:**
- [SKILL.md](SKILL.md)
- [routing-and-controllers.md](routing-and-controllers.md)
- [async-and-errors.md](async-and-errors.md)
