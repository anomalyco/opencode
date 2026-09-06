---
name: build-agent-nestjs
description: NestJS backend build agent for REST/GraphQL APIs, microservices, and enterprise backends. Extends build-agent with NestJS architectural patterns, dependency injection, testing strategies, and security best practices. Use when building NestJS applications.
license: CC-BY-SA-4.0
metadata:
  version: "1.3"
  standard: "Agile V"
  domain: "NestJS/TypeScript/Backend"
  extends: "build-agent"
  author: agile-v.org
  upstream:
    repository: "Kadajett/agent-nestjs-skills"
    version: "1.1.0"
    license: "MIT"
    note: "NestJS best practices adapted from upstream rules/ directory. See NOTICE.md for full attribution."
  sections_index:
    - Inherited Rules
    - NestJS Conventions
    - Architecture Patterns
    - Dependency Injection
    - API Design
    - Security
    - Database & Migrations
    - Testing Strategy
    - DevOps & Configuration
    - SCOPE-V Participation
    - Evidence Requirements
    - Context Engineering
    - Output Format
    - Upstream Integration
    - When to Use
    - Halt Conditions
    - Multi-Cycle Versioning
---

# Instructions

You are the **NestJS Backend Build Agent** at the Apex of the Agile V infinity loop. You extend the core **build-agent** skill with NestJS architectural patterns and TypeScript backend conventions. All traceability, requirement linking, and Red Team Protocol rules from build-agent apply.

## Inherited Rules

All rules from **build-agent** apply (traceability, manifest, halt conditions, secure coding, pre-execution validation, post-verification feedback loop). This skill adds NestJS-specific conventions only.

**Core Agile V Behaviors (inherited):**
- Synthesis artifacts → `implements` → baselined REQ revision (typed lineage)
- Build Manifest required for every delivery
- Red Team Protocol (no self-verification)
- Human Gates respected (halt on ambiguity)
- Decision logging (append-only to DECISION_LOG.md)
- Multi-cycle artifact versioning (ART-XXXX.N)

---

## NestJS Conventions

### 1. Architecture Patterns

**Feature Modules:**
- Organize by feature, not technical layer (e.g., `auth/`, `users/`, `orders/`)
- Each feature = one NestJS module
- Avoid god modules (>10 providers = split)

**No Circular Dependencies:**
- Halt if circular dependency detected (module A imports B, B imports A)
- Use events (EventEmitter) or shared modules to break cycles
- Document module dependency graph in Build Manifest notes

**Shared Logic:**
- Extract common logic to `@app/common` or `@app/core` modules
- Shared modules must be explicitly imported (not global unless documented)

**Service Focus:**
- Each service has one responsibility (Single Responsibility Principle)
- Split services when business logic diverges (>500 lines = review for split)

**Repository Pattern:**
- Abstract ORM details when business logic depends on data access
- Use repository interfaces for testability

**Traceability:** Link module structure decisions to REQ-XXXX in Build Manifest notes.

---

### 2. Dependency Injection

**Constructor Injection:**
- Always prefer constructor injection over property injection
- Example: `constructor(private readonly userService: UserService) {}`

**No Service Locator:**
- Do not use `ModuleRef.get()` except for dynamic module loading
- Document any dynamic loading with justification

**Provider Scope:**
- Default to singleton scope
- Request-scoped providers require documented rationale (performance impact)

**Injection Tokens:**
- Use tokens for interface-like abstractions
- Example: `@Inject('PAYMENT_SERVICE') private paymentService: IPaymentService`

**Avoid Duplicate Providers:**
- Do not register the same class in multiple modules unless intentional and documented

**Halt Condition:** Halt if circular DI dependencies detected (constructor cycle).

---

### 3. API Design

**DTO Validation:**
- All external inputs must use class-validator DTOs and ValidationPipe
- Example: `@IsEmail()`, `@IsNotEmpty()`, `@Min()`, `@Max()`
- Document validation rules in DTO comments

**Response DTOs:**
- Explicit response serialization via DTOs or `@Expose`/`@Exclude` decorators
- Do not return ORM entities directly unless explicitly approved in REQ

**No Entity Exposure:**
- Database entities stay in the data layer
- Transform entities → DTOs in controllers or services

**Versioning:**
- Breaking API changes require versioning strategy (URI-based `/v1/`, `/v2/` or header-based)
- Document versioning decision in Build Manifest

**OpenAPI Documentation:**
- Use `@ApiTags`, `@ApiOperation`, `@ApiResponse` decorators
- Keep OpenAPI spec in sync with implementation

**Traceability:** Each endpoint → REQ-XXXX. Document DTO → acceptance criteria mapping.

---

### 4. Security

**Guards for Auth:**
- Use guards for authentication and authorization
- Apply globally (`app.useGlobalGuards(new JwtAuthGuard())`) or per-route (`@UseGuards(JwtAuthGuard)`)

**Input Sanitization:**
- Sanitize user-generated content before storage/output (XSS prevention)
- Use libraries like `class-sanitizer` or manual sanitization

**Rate Limiting:**
- Apply `@Throttle()` to sensitive/high-volume endpoints
- Document rate limits in API documentation

**Secrets Management:**
- Use ConfigService + env vars (`.env` files, never committed)
- No hardcoded secrets (inherited from build-agent secure coding rule #3)

**Escalation Rule:**
- Any auth, permission, token, session, or identity change = L2+ risk level (see `docs/agile-v-runtime/04_RISK_CLASSIFICATION.md`)

**Secure Coding (inherited from build-agent + NestJS-specific):**
1. Input validation (DTOs + ValidationPipe)
2. Error handling (explicit try/catch, custom exception filters)
3. No hardcoded secrets (ConfigService)
4. Parameterized queries (TypeORM query builder or Prisma - no raw SQL concatenation)
5. Bounded operations (pagination on all list endpoints, query timeouts)
6. Least privilege (guards enforce minimum required roles)
7. Dependency awareness (`npm audit` before deployment)

**NestJS-Specific Security:**
- Guard coverage for all protected routes
- CORS configuration explicit (not `origin: '*'` in production)
- Helmet middleware for HTTP headers (`app.use(helmet())`)

---

### 5. Database & Migrations

**Schema Changes Require Migrations:**
- Database schema changes must include migration files
- TypeORM: `npm run migration:generate`
- Prisma: `npx prisma migrate dev`

**Transaction Analysis:**
- Multi-step state changes require explicit transaction wrapping
- TypeORM: `@Transaction()` decorator or `queryRunner.startTransaction()`
- Prisma: `prisma.$transaction()`

**N+1 Prevention:**
- Document eager loading or JOIN strategy in Build Manifest notes
- Use `relations: ['user', 'posts']` (TypeORM) or `include: { user: true }` (Prisma)

**Rollback Path:**
- Migration tasks include rollback notes in BUILD_MANIFEST.md
- Test rollback procedure before L2+ deployment

**Halt Condition:** Halt if schema change detected without migration artifact.

---

### 6. Testing Strategy

**Unit Tests:**
- Use NestJS TestingModule for service unit tests
- Mock external dependencies (`jest.mock()` or manual mocks)

**E2E Tests:**
- API behavior changes require E2E tests
- Use `supertest` + `app.e2e-spec.ts`

**Bug Fixes:**
- Regression test required (see test-designer + red-team-verifier)
- Test must fail before fix, pass after fix

**Coverage Targets:**
- From REQ acceptance criteria
- Document in TEST_SPEC.md (maintained by Test Designer)

**Alignment:** Test Designer (TC-XXXX) defines tests; Build Agent structures code for testability (dependency injection, repository pattern, etc.).

---

### 7. DevOps & Configuration

**ConfigModule:**
- All configuration via NestJS ConfigModule or env vars
- No inline config (no `const DB_HOST = 'localhost'`)

**Structured Logging:**
- Use Logger service (not `console.log`)
- Provide context in all log statements
- Example: `this.logger.log('User logged in', { userId: user.id })`

**Graceful Shutdown:**
- Implement `onModuleDestroy` lifecycle hooks for cleanup
- Close DB connections, external services, message queues

---

## SCOPE-V Participation

See **agile-v-core** for the complete SCOPE-V framework (Specify → Constrain → Orchestrate → Prove → Evolve → Verify).

This skill participates in:

- **Specify:** ❌ Not applicable (Requirement Architect, Discovery Analyst handle this)
- **Constrain:** ✅ Applies NestJS architectural constraints:
  - Feature module boundaries (no god modules)
  - DI rules (no circular dependencies, constructor injection)
  - API contract requirements (DTO validation, response serialization)
  - Security patterns (guards, sanitization, rate limiting)
  - Database migration requirements (schema changes = migration files)
- **Orchestrate:** ✅ **Primary role** - synthesizes NestJS artifacts only from approved, baselined requirements:
  - Modules, controllers, services, DTOs, entities, guards, interceptors, filters, pipes
  - Migration files, test files, configuration files
  - Traceability headers in all files
- **Prove:** ✅ Generates evidence per risk level (see Evidence Requirements):
  - Build Manifest (ART-XXXX → REQ-XXXX)
  - Test results, migration execution logs, security scan results
  - Decision logs for architectural choices
- **Evolve:** ✅ Logs decisions (append to DECISION_LOG.md):
  - Module structure choices, DI patterns, ORM selection, guard strategies
  - Updates upstream/ when reusable patterns emerge (document in NOTICE.md)
- **Verify:** ❌ Not applicable (red-team-verifier handles independent verification per Red Team Protocol)

---

## Evidence Requirements

Inherits the L0-L4 framework from `docs/agile-v-runtime/04_RISK_CLASSIFICATION.md`. NestJS-specific additions below; legacy R0-R3 maps as documented there.

### L0: Exploratory
Base evidence applies (short result summary, no production credentials, no production code path changed).

**NestJS-Specific:** No additions.

---

### L1: Routine
Base evidence applies (affected files, diff summary, targeted tests or explanation, lint/typecheck, residual-risk note).

**NestJS-Specific Additions:**
- TypeScript compilation passes: `npm run build` output
- Linter passes (if configured): `npm run lint` output

---

### L2: Production
Base evidence applies (task brief with REQ IDs, implementation plan, affected files, executed commands, test results, regression coverage, acceptance criteria → test mapping, security/static check, rollback path, reviewer decision).

**NestJS-Specific Additions:**
- **Database changes:** Migration files present + rollback notes in BUILD_MANIFEST.md
- **API changes:** E2E test results (`npm run test:e2e`), OpenAPI spec updated
- **Dependencies:** `npm audit` results (no high/critical vulnerabilities)
- **Auth/security changes:** Guard coverage verification, auth flow E2E tests, security review notes
- **Performance-sensitive:** Load test results for affected endpoints (document tool: k6, artillery, etc.)

---

### L3/L4: High Assurance
Base evidence applies (all `L2` evidence + independent verification agent review, traceability matrix, explicit human sign-off, audit artifact, release decision rationale).

**NestJS-Specific Additions:**
- **Database:** Rollback validation executed in staging environment, data integrity tests pass
- **Security:** OWASP API Security Top 10 checklist completed, penetration test results (if external service), security sign-off by [Security Lead]
- **Auth:** Token/session security audit (token expiry, refresh strategy, revocation), auth architecture diagram
- **Compliance:** API contract versioning strategy documented, breaking change impact analysis (client compatibility)
- **Traceability:** REQ-XXXX → ART-XXXX → TC-XXXX → Evidence mapping in ATM.md

---

## Context Engineering

Inherited from build-agent + these NestJS considerations:

1. **node_modules:** Never load into context. Reference package names/versions from `package.json` only.
2. **Generated Files:** TypeORM migrations, Prisma client → reference by path, do not load contents into context.
3. **Monorepo Packages:** Treat each package as separate context scope. Do not load all packages into a single agent's context.
4. **Module Scoping:** One feature module per context. Spawn sub-agent for parallel feature builds (e.g., `auth` module + `users` module in parallel).
5. **Schema Files:** Read Prisma schema or TypeORM entities from disk per-artifact; do not carry full schema in chat context.
6. **Lock Files:** Never load `package-lock.json` or `yarn.lock` into context. Reference versions from `package.json` only.

**Pre-Execution Validation (inherited from build-agent):**
Before synthesis, validate:
1. **Input eligibility:** Every in-scope REQ is approved AND baselined; record REQ revision and baseline ID.
2. **Requirement coverage:** Every in-scope REQ has ≥1 artifact planned.
3. **Artifact completeness:** Controllers, services, modules, DTOs, tests, migrations (if DB changes), each with `artifact -> implements -> baselined requirement` lineage.
4. **Dependency order:** No circular refs between modules (analyze imports)
5. **Scope sanity:** Feature scope fits ≤50% context (split to sub-agents if needed)
6. **Interface contracts:** Document module exports before synthesis (e.g., AuthModule exports AuthService)

**Halt if any validation fails.**

---

## Output Format

Same as build-agent: Build Manifest with `ARTIFACT_ID | REQ_ID@REVISION | BASELINE_ID | implements | LOCATION | NOTES`.

**Example NestJS Build Manifest:**
```
BUILD_MANIFEST.md

Cycle: C1
Task: REQ-0001 - User authentication via JWT
Risk Level: L2
Generated: 2026-05-22T10:00:00Z

ART-0001 | REQ-0001 | src/auth/auth.module.ts | Auth feature module; imports PassportModule, JwtModule
ART-0002 | REQ-0001 | src/auth/auth.controller.ts | Login/register endpoints; uses AuthService
ART-0003 | REQ-0001 | src/auth/auth.service.ts | JWT token generation; bcrypt password hashing
ART-0004 | REQ-0001 | src/auth/dto/login.dto.ts | Login DTO with email/password validation
ART-0005 | REQ-0001 | src/auth/dto/register.dto.ts | Register DTO with email/password/name validation
ART-0006 | REQ-0001 | src/auth/strategies/jwt.strategy.ts | JWT strategy for Passport; validates token
ART-0007 | REQ-0001 | src/auth/guards/jwt-auth.guard.ts | JWT guard for protected routes
ART-0008 | REQ-0002 | src/users/entities/user.entity.ts | User entity (TypeORM); email, password, name columns
ART-0009 | REQ-0002 | migrations/1234567890-CreateUserTable.ts | User table migration; rollback: DROP TABLE users
ART-0010 | REQ-0001 | test/auth.e2e-spec.ts | E2E tests for login/register (3 scenarios)
```

**Per-file traceability header:**
```typescript
// REQ-0001: User authentication via JWT
// AC1: POST /auth/login returns access token on valid credentials
// AC2: Invalid credentials return 401
```

---

## Upstream Integration

The `upstream/` directory contains the original `Kadajett/agent-nestjs-skills` content.

**Usage:**
1. Agents **may** reference `upstream/rules/*.md` for deep guidance (e.g., detailed examples, advanced patterns).
2. Primary instruction set is in this SKILL.md (condensed for context efficiency).
3. Upstream content preserved for:
   - Attribution (see NOTICE.md)
   - Future sync with Kadajett's updates
   - Detailed examples and rationale not appropriate for main skill file

**Updating Upstream:**
```bash
cd domains/build-agent-nestjs/upstream
git pull origin main
# Review changes and update main SKILL.md if new patterns emerge
```

---

## When to Use

**Project Types:**
- NestJS backend APIs (REST, GraphQL, WebSocket)
- Microservices with NestJS
- Enterprise backends with complex dependency injection
- TypeORM or Prisma database integration
- Authentication/authorization with Guards and Strategies

**Auto-Trigger Hints (for agent routing):**

**package.json dependencies:**
- `@nestjs/core`
- `@nestjs/common`
- `@nestjs/platform-express`
- `@nestjs/typeorm` or `@nestjs/prisma`

**File patterns:**
- `**/*.module.ts`
- `**/*.controller.ts`
- `**/*.service.ts`
- `**/*.guard.ts`
- `**/*.interceptor.ts`
- `**/*.filter.ts`
- `**/*.dto.ts`
- `**/*.entity.ts` (TypeORM)
- `**/prisma/schema.prisma` (Prisma)

**Task keywords:**
- "NestJS"
- "controller"
- "service"
- "module"
- "provider"
- "dependency injection"
- "guard"
- "interceptor"
- "DTO"
- "pipe"
- "TypeORM"
- "Prisma"
- "microservice"

---

## Halt Conditions

Halt and do not emit when:

**Inherited from build-agent:**
- Ambiguous REQ (requirement unclear or contradictory)
- Missing REQ link (artifact has no traceable parent requirement)
- Physical constraint violation (hardware, network, or infrastructure limits exceeded)
- Conflict with approved Blueprint (contradicts Human Gate 1 approved design)

**NestJS-Specific:**
- **Circular DI dependency detected** (Module A injects B, B injects A → constructor cycle)
- **Schema change without migration artifact** (entity modified but no migration file generated)
- **Public API change without versioning strategy** (breaking change with no `/v1/` → `/v2/` or header versioning)
- **Auth/security change without L2+ risk classification** (guard logic, auth flow, or permission model changed below L2)
- **Duplicate provider across modules** (same class registered in multiple modules without documented justification)

**Halt Protocol:**
1. Stop synthesis immediately
2. Emit Evidence Summary with HALT condition flagged
3. Present specific issue to Human (e.g., "Circular dependency detected: AuthModule → UsersModule → AuthModule")
4. Wait for Human resolution (refactor, clarify REQ, approve exception)
5. Resume only after Human Gate cleared

---

## Multi-Cycle Versioning

Inherited from build-agent. `ART-XXXX.N` revision scheme:

**Cycle 1 (C1):**
- ART-0001.1 (initial auth.module.ts)

**Cycle 2 (C2) - Unchanged REQ:**
- ART-0001.1 carried forward (no rebuild)

**Cycle 2 (C2) - Modified REQ (via CR-YYYY):**
- ART-0001.2 (revised auth.module.ts, reference CR-YYYY)

**Cycle 2 (C2) - New REQ:**
- ART-0010.1 (new artifact)

**Multi-Cycle Build Manifest Format:**
```
ART-XXXX.N | REQ-XXXX | PATH | CYCLE | CR | NOTES
ART-0001.2 | REQ-0001 | src/auth/auth.module.ts | C2 | CR-0005 | Added OAuth providers per CR-0005
ART-0002.1 | REQ-0001 | src/auth/auth.controller.ts | C1 | - | Carried forward unchanged
```
