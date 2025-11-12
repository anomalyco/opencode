# Architecture Overview - Backend Services

Complete guide to the layered architecture pattern used in backend microservices.

## Table of Contents

- [Layered Architecture Pattern](#layered-architecture-pattern)
- [Request Lifecycle](#request-lifecycle)
- [Service Comparison](#service-comparison)
- [Directory Structure Rationale](#directory-structure-rationale)
- [Module Organization](#module-organization)
- [Separation of Concerns](#separation-of-concerns)

---

## Layered Architecture Pattern

### The Four Layers

```
┌─────────────────────────────────────┐
│         HTTP Request                │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│  Layer 1: ROUTES                    │
│  - Route definitions only           │
│  - Middleware registration          │
│  - Delegate to controllers          │
│  - NO business logic                │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│  Layer 2: CONTROLLERS               │
│  - Request/response handling        │
│  - Input validation                 │
│  - Call services                    │
│  - Format responses                 │
│  - Error handling                   │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│  Layer 3: SERVICES                  │
│  - Business logic                   │
│  - Orchestration                    │
│  - Call repositories                │
│  - No HTTP knowledge                │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│  Layer 4: REPOSITORIES              │
│  - Data access abstraction          │
│  - Prisma operations                │
│  - Query optimization               │
│  - Caching                          │
└───────────────┬─────────────────────┘
                ↓
┌─────────────────────────────────────┐
│         Database (MySQL)            │
└─────────────────────────────────────┘
```

### Why This Architecture?

**Testability:**
- Each layer can be tested independently
- Easy to mock dependencies
- Clear test boundaries

**Maintainability:**
- Changes isolated to specific layers
- Business logic separate from HTTP concerns
- Easy to locate bugs

**Reusability:**
- Services can be used by routes, cron jobs, scripts
- Repositories hide database implementation
- Business logic not tied to HTTP

**Scalability:**
- Easy to add new endpoints
- Clear patterns to follow
- Consistent structure

---

## Request Lifecycle

### Complete Flow Example

```typescript
1. HTTP POST /api/users
   ↓
2. Express matches route in userRoutes.ts
   ↓
3. Middleware chain executes:
   - SSOMiddleware.verifyLoginStatus (authentication)
   - auditMiddleware (context tracking)
   ↓
4. Route handler delegates to controller:
   router.post('/users', (req, res) => userController.create(req, res))
   ↓
5. Controller validates and calls service:
   - Validate input with Zod
   - Call userService.create(data)
   - Handle success/error
   ↓
6. Service executes business logic:
   - Check business rules
   - Call userRepository.create(data)
   - Return result
   ↓
7. Repository performs database operation:
   - PrismaService.main.user.create({ data })
   - Handle database errors
   - Return created user
   ↓
8. Response flows back:
   Repository → Service → Controller → Express → Client
```

### Middleware Execution Order

**Critical:** Middleware executes in registration order

```typescript
app.use(Sentry.Handlers.requestHandler());  // 1. Sentry tracing (FIRST)
app.use(express.json());                     // 2. Body parsing
app.use(express.urlencoded({ extended: true })); // 3. URL encoding
app.use(cookieParser());                     // 4. Cookie parsing
app.use(SSOMiddleware.initialize());         // 5. Auth initialization
// ... routes registered here
app.use(auditMiddleware);                    // 6. Audit (if global)
app.use(errorBoundary);                      // 7. Error handler (LAST)
app.use(Sentry.Handlers.errorHandler());     // 8. Sentry errors (LAST)
```

**Rule:** Error handlers must be registered AFTER routes!

---

## Service Comparison

### Email Service (Mature Pattern ✅)

**Strengths:**
- Comprehensive BaseController with Sentry integration
- Clean route delegation (no business logic in routes)
- Consistent dependency injection pattern
- Good middleware organization
- Type-safe throughout
- Excellent error handling

**Example Structure:**
```
email/src/
├── controllers/
│   ├── BaseController.ts          ✅ Excellent template
│   ├── NotificationController.ts  ✅ Extends BaseController
│   └── EmailController.ts         ✅ Clean patterns
├── routes/
│   ├── notificationRoutes.ts      ✅ Clean delegation
│   └── emailRoutes.ts             ✅ No business logic
├── services/
│   ├── NotificationService.ts     ✅ Dependency injection
│   └── BatchingService.ts         ✅ Clear responsibility
└── middleware/
    ├── errorBoundary.ts           ✅ Comprehensive
    └── DevImpersonationSSOMiddleware.ts
```

**Use as template** for new services!

### Form Service (Transitioning ⚠️)

**Strengths:**
- Excellent workflow architecture (event sourcing)
- Good Sentry integration
- Innovative audit middleware (AsyncLocalStorage)
- Comprehensive permission system

**Weaknesses:**
- Some routes have 200+ lines of business logic
- Inconsistent controller naming
- Direct process.env usage (60+ occurrences)
- Minimal repository pattern usage

**Example:**
```
form/src/
├── routes/
│   ├── responseRoutes.ts          ❌ Business logic in routes
│   └── proxyRoutes.ts             ✅ Good validation pattern
├── controllers/
│   ├── formController.ts          ⚠️ Lowercase naming
│   └── UserProfileController.ts   ✅ PascalCase naming
├── workflow/                      ✅ Excellent architecture!
│   ├── core/
│   │   ├── WorkflowEngineV3.ts   ✅ Event sourcing
│   │   └── DryRunWrapper.ts      ✅ Innovative
│   └── services/
└── middleware/
    └── auditMiddleware.ts         ✅ AsyncLocalStorage pattern
```

**Learn from:** workflow/, middleware/auditMiddleware.ts
**Avoid:** responseRoutes.ts, direct process.env

---

## Directory Structure Rationale

### Controllers Directory

**Purpose:** Handle HTTP request/response concerns

**Contents:**
- `BaseController.ts` - Base class with common methods
- `{Feature}Controller.ts` - Feature-specific controllers

**Naming:** PascalCase + Controller

**Responsibilities:**
- Parse request parameters
- Validate input (Zod)
- Call appropriate service methods
- Format responses
- Handle errors (via BaseController)
- Set HTTP status codes

### Services Directory

**Purpose:** Business logic and orchestration

**Contents:**
- `{feature}Service.ts` - Feature business logic

**Naming:** camelCase + Service (or PascalCase + Service)

**Responsibilities:**
- Implement business rules
- Orchestrate multiple repositories
- Transaction management
- Business validations
- No HTTP knowledge (Request/Response types)

### Repositories Directory

**Purpose:** Data access abstraction

**Contents:**
- `{Entity}Repository.ts` - Database operations for entity

**Naming:** PascalCase + Repository

**Responsibilities:**
- Prisma query operations
- Query optimization
- Database error handling
- Caching layer
- Hide Prisma implementation details

**Current Gap:** Only 1 repository exists (WorkflowRepository)

### Routes Directory

**Purpose:** Route registration ONLY

**Contents:**
- `{feature}Routes.ts` - Express router for feature

**Naming:** camelCase + Routes

**Responsibilities:**
- Register routes with Express
- Apply middleware
- Delegate to controllers
- **NO business logic!**

### Middleware Directory

**Purpose:** Cross-cutting concerns

**Contents:**
- Authentication middleware
- Audit middleware
- Error boundaries
- Validation middleware
- Custom middleware

**Naming:** camelCase

**Types:**
- Request processing (before handler)
- Response processing (after handler)
- Error handling (error boundary)

### Config Directory

**Purpose:** Configuration management

**Contents:**
- `unifiedConfig.ts` - Type-safe configuration
- Environment-specific configs

**Pattern:** Single source of truth

### Types Directory

**Purpose:** TypeScript type definitions

**Contents:**
- `{feature}.types.ts` - Feature-specific types
- DTOs (Data Transfer Objects)
- Request/Response types
- Domain models

---

## Module Organization

### Feature-Based Organization

For large features, use subdirectories:

```
src/workflow/
├── core/              # Core engine
├── services/          # Workflow-specific services
├── actions/           # System actions
├── models/            # Domain models
├── validators/        # Workflow validation
└── utils/             # Workflow utilities
```

**When to use:**
- Feature has 5+ files
- Clear sub-domains exist
- Logical grouping improves clarity

### Flat Organization

For simple features:

```
src/
├── controllers/UserController.ts
├── services/userService.ts
├── routes/userRoutes.ts
└── repositories/UserRepository.ts
```

**When to use:**
- Simple features (< 5 files)
- No clear sub-domains
- Flat structure is clearer

---

## Separation of Concerns

### What Goes Where

**Routes Layer:**
- ✅ Route definitions
- ✅ Middleware registration
- ✅ Controller delegation
- ❌ Business logic
- ❌ Database operations
- ❌ Validation logic (should be in validator or controller)

**Controllers Layer:**
- ✅ Request parsing (params, body, query)
- ✅ Input validation (Zod)
- ✅ Service calls
- ✅ Response formatting
- ✅ Error handling
- ❌ Business logic
- ❌ Database operations

**Services Layer:**
- ✅ Business logic
- ✅ Business rules enforcement
- ✅ Orchestration (multiple repos)
- ✅ Transaction management
- ❌ HTTP concerns (Request/Response)
- ❌ Direct Prisma calls (use repositories)

**Repositories Layer:**
- ✅ Prisma operations
- ✅ Query construction
- ✅ Database error handling
- ✅ Caching
- ❌ Business logic
- ❌ HTTP concerns

### Example: User Creation

**Route:**
```typescript
router.post('/users',
    SSOMiddleware.verifyLoginStatus,
    auditMiddleware,
    (req, res) => userController.create(req, res)
);
```

**Controller:**
```typescript
async create(req: Request, res: Response): Promise<void> {
    try {
        const validated = createUserSchema.parse(req.body);
        const user = await this.userService.create(validated);
        this.handleSuccess(res, user, 'User created');
    } catch (error) {
        this.handleError(error, res, 'create');
    }
}
```

**Service:**
```typescript
async create(data: CreateUserDTO): Promise<User> {
    // Business rule: check if email already exists
    const existing = await this.userRepository.findByEmail(data.email);
    if (existing) throw new ConflictError('Email already exists');

    // Create user
    return await this.userRepository.create(data);
}
```

**Repository:**
```typescript
async create(data: CreateUserDTO): Promise<User> {
    return PrismaService.main.user.create({ data });
}

async findByEmail(email: string): Promise<User | null> {
    return PrismaService.main.user.findUnique({ where: { email } });
}
```

**Notice:** Each layer has clear, distinct responsibilities!

---

**Related Files:**
- [SKILL.md](SKILL.md) - Main guide
- [routing-and-controllers.md](routing-and-controllers.md) - Routes and controllers details
- [services-and-repositories.md](services-and-repositories.md) - Service and repository patterns
