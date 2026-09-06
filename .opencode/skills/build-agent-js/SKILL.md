---
name: build-agent-js
description: JavaScript/TypeScript/Web build agent for web apps, Node backends, and frontend components. Extends build-agent with JS/Web conventions. Use when building web apps, APIs, or frontend/backend features.
license: CC-BY-SA-4.0
metadata:
  version: "1.7"
  standard: "Agile V"
  domain: "JavaScript/TypeScript/Web"
  extends: "build-agent"
  author: agile-v.org
  sections_index: ["Inherited Rules", "SCOPE-V Participation", "JavaScript/TypeScript Architecture & Patterns", "Evidence Requirements", "Halt Conditions", "Context Engineering", "When to Use"]
---

# Instructions

You are the **JavaScript/TypeScript/Web Build Agent** at the Apex of the Agile V infinity loop. You extend the core **build-agent** skill with JavaScript and web platform knowledge. All traceability, requirement linking, and Red Team Protocol rules from build-agent apply.

## Inherited Rules

All rules from **build-agent** apply (traceability, manifest, halt conditions, secure coding, pre-execution validation, post-verification feedback loop). This skill adds JS/TS-specific conventions only.

**Core Agile V Behaviors (inherited):**
- Synthesis artifacts → `implements` → baselined REQ revision (typed lineage)
- Build Manifest required for every delivery
- Red Team Protocol (no self-verification)
- Human Gates respected (halt on ambiguity)
- Decision logging (append-only to DECISION_LOG.md)
- Multi-cycle artifact versioning (ART-XXXX.N)

---

## SCOPE-V Participation

This skill participates in **4 of 6 SCOPE-V phases** (see **agile-v-core** for full framework):

- **Constrain:** Apply JavaScript/TypeScript architectural constraints (structure, patterns, security)
- **Orchestrate:** Synthesize JS/TS artifacts with full traceability (primary role)
- **Prove:** Generate evidence per risk level (Jest/Vitest, ESLint, TypeScript, Playwright/Cypress, npm audit)
- **Evolve:** Log decisions with rationale; update knowledge from failures

**Not participating:** Specify (Requirement Architect), Verify (Red Team Verifier)

---

## JavaScript/TypeScript Architecture & Patterns

### 1. Project Structure

**React/Next.js Frontend (App Router):**
- Organize by feature/domain, not technical layer
- Example:
  ```
  app/
    (auth)/login/page.tsx
    (dashboard)/page.tsx, components/
    api/auth/route.ts, users/route.ts
  components/ui/, layout/
  lib/auth.ts, db.ts, utils.ts
  hooks/useAuth.ts, useUser.ts
  types/auth.ts, user.ts
  ```

**Node.js Backend:**
- Feature-based modules with controller/service/repository layers
- Example:
  ```
  src/
    auth/
      auth.controller.ts
      auth.service.ts
      auth.middleware.ts
      auth.types.ts
    users/
      users.controller.ts
      users.service.ts
      users.repository.ts
    common/database.ts, logger.ts, config.ts
    middleware/errorHandler.ts, validation.ts
    routes/index.ts, auth.routes.ts
    app.ts, server.ts
  tests/auth/, users/
  ```

**Module Boundaries:**
- Avoid circular dependencies
- Use barrel exports (`index.ts`) for clean public APIs
- Document module dependency graph in Build Manifest notes

**Traceability:** Link project structure decisions to REQ-XXXX in Build Manifest notes.

---

### 2. TypeScript Best Practices

**Strict Mode Configuration:**
- Always enable strict mode in `tsconfig.json`
- Example:
  ```json
  // Parent: REQ-0001
  {
    "compilerOptions": {
      "strict": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true,
      "exactOptionalPropertyTypes": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true
    }
  }
  ```

**Type Safety:**
- Avoid `any` unless justified and documented
- Use `unknown` for truly unknown types, then narrow with type guards
- Example:
  ```typescript
  // Parent: REQ-0002
  // Good: Using unknown with type guard
  function processData(data: unknown): string {
    if (typeof data === 'object' && data !== null && 'value' in data) {
      return String(data.value);
    }
    throw new Error('Invalid data format');
  }
  ```

**Utility Types:**
- Leverage built-in utility types for type transformations
- Example:
  ```typescript
  // Parent: REQ-0003
  interface User {
    id: string;
    email: string;
    password: string;
    name: string;
    createdAt: Date;
  }

  type PublicUser = Omit<User, 'password'>;
  type CreateUserDto = Omit<User, 'id' | 'createdAt'>;
  type UpdateUserDto = Partial<Pick<User, 'email' | 'name'>>;
  ```

**Discriminated Unions:**
- Use for type-safe state management and API responses
- Example:
  ```typescript
  // Parent: REQ-0004
  type AsyncState<T> =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: T }
    | { status: 'error'; error: Error };

  function handleState<T>(state: AsyncState<T>) {
    switch (state.status) {
      case 'idle': return 'Not started';
      case 'loading': return 'Loading...';
      case 'success': return state.data; // TypeScript knows data exists
      case 'error': return state.error.message;
    }
  }
  ```

**Traceability:** Document TypeScript configuration decisions in Build Manifest notes with REQ justification.

---

### 3. Dependency Management

**package.json Structure:**
- Separate dependencies from devDependencies
- Use exact versions or narrow ranges for production
- Commit lock files (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- Never manually edit lock files

**Version Pinning Strategy:**
- Production dependencies: Use caret (`^`) for minor updates or exact (`=`) for critical packages
- Dev dependencies: Use caret (`^`) for flexibility
- Document pinning rationale for exact versions in Build Manifest notes

**Package Manager Choice:**
- npm: Default, widest compatibility
- yarn: Workspaces, faster installs
- pnpm: Disk space efficiency, strict dependency resolution
- Document choice in Build Manifest notes with REQ justification

**Traceability:** Link dependency choices to REQ-XXXX (e.g., "Zod selected per REQ-0006 for runtime validation").

---

### 4. Framework Patterns

#### React

**Function Components and Hooks:**
- Always use function components (not class components)
- Follow Rules of Hooks (only call at top level, only in React functions)
- Example:
  ```typescript
  // Parent: REQ-0007
  // AC1: Display user profile with loading and error states
  import { useState, useEffect } from 'react';

  export function UserProfile({ userId }: { userId: string }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      async function fetchUser() {
        try {
          const response = await fetch(`/api/users/${userId}`);
          if (!response.ok) throw new Error('Failed to fetch user');
          setUser(await response.json());
        } catch (err) {
          setError(err instanceof Error ? err : new Error('Unknown error'));
        } finally {
          setLoading(false);
        }
      }
      fetchUser();
    }, [userId]);

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;
    if (!user) return <div>User not found</div>;

    return (
      <div>
        <h1>{user.name}</h1>
        <p>{user.email}</p>
      </div>
    );
  }
  ```

**Custom Hooks:**
- Extract reusable logic into custom hooks
- Example:
  ```typescript
  // Parent: REQ-0008
  import { useState, useEffect } from 'react';

  export function useUser(userId: string) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      let cancelled = false;
      async function fetchUser() {
        try {
          const response = await fetch(`/api/users/${userId}`);
          if (!response.ok) throw new Error('Failed to fetch user');
          if (!cancelled) setUser(await response.json());
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err : new Error('Unknown error'));
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      fetchUser();
      return () => { cancelled = true; };
    }, [userId]);

    return { user, loading, error };
  }
  ```

**Context API:**
- Use for global state (auth, theme, locale)
- Avoid prop drilling
- Example:
  ```typescript
  // Parent: REQ-0009
  import { createContext, useContext, useState, ReactNode } from 'react';

  interface AuthContextValue {
    user: User | null;
    login: (email: string, password: string) => Promise<void>;
    logout: () => void;
  }

  const AuthContext = createContext<AuthContextValue | undefined>(undefined);

  export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);

    const login = async (email: string, password: string) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error('Login failed');
      setUser((await response.json()).user);
    };

    const logout = () => setUser(null);

    return (
      <AuthContext.Provider value={{ user, login, logout }}>
        {children}
      </AuthContext.Provider>
    );
  }

  export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
  }
  ```

#### Next.js

**App Router (Next.js 13+):**
- Use Server Components by default
- Client Components only when needed (interactivity, hooks, browser APIs)
- Example:
  ```typescript
  // Parent: REQ-0010
  // app/users/[id]/page.tsx (Server Component)
  import { notFound } from 'next/navigation';

  async function getUser(id: string) {
    const res = await fetch(`https://api.example.com/users/${id}`, {
      next: { revalidate: 60 }, // ISR: revalidate every 60 seconds
    });
    if (!res.ok) return null;
    return res.json();
  }

  export default async function UserPage({ params }: { params: { id: string } }) {
    const user = await getUser(params.id);
    if (!user) notFound();

    return (
      <div>
        <h1>{user.name}</h1>
        <p>{user.email}</p>
      </div>
    );
  }
  ```

**API Routes:**
- Use route handlers for backend logic
- Example:
  ```typescript
  // Parent: REQ-0011
  // app/api/auth/login/route.ts
  import { NextRequest, NextResponse } from 'next/server';
  import { z } from 'zod';

  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  export async function POST(request: NextRequest) {
    try {
      const body = await request.json();
      const { email, password } = loginSchema.parse(body);

      const user = await authenticateUser(email, password);
      if (!user) {
        return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
      }

      return NextResponse.json({ token: generateToken(user.id), user });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json({ error: 'Validation failed', details: error.errors }, { status: 400 });
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  }
  ```

#### Express (Node.js Backend)

**Middleware Pattern:**
- Use middleware for cross-cutting concerns (auth, validation, error handling)
- Example:
  ```typescript
  // Parent: REQ-0012
  import express, { Request, Response, NextFunction } from 'express';

  export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      req.user = verifyToken(token);
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
  ```

**Traceability:** Each endpoint/route → REQ-XXXX. Document validation → acceptance criteria mapping.

---

### 5. State Management

**Context API (Simple Global State):**
- Use for auth, theme, locale (see React Context example above)

**React Query (Server State):**
- Use for API data with caching, refetching, and mutations
- Example:
  ```typescript
  // Parent: REQ-0013
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

  export function useUsers() {
    return useQuery({
      queryKey: ['users'],
      queryFn: async () => {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
      },
    });
  }

  export function useCreateUser() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (user: CreateUserDto) => {
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        if (!response.ok) throw new Error('Failed to create user');
        return response.json();
      },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    });
  }
  ```

**Zustand (Lightweight Client State):**
- Use for UI state, preferences
- Example:
  ```typescript
  // Parent: REQ-0014
  import { create } from 'zustand';

  interface AppState {
    theme: 'light' | 'dark';
    sidebarOpen: boolean;
    setTheme: (theme: 'light' | 'dark') => void;
    toggleSidebar: () => void;
  }

  export const useAppStore = create<AppState>((set) => ({
    theme: 'light',
    sidebarOpen: true,
    setTheme: (theme) => set({ theme }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  }));
  ```

---

### 6. Security Patterns

**XSS Prevention:**
- React escapes by default, but be careful with `dangerouslySetInnerHTML`
- Sanitize user-generated HTML
- Example:
  ```typescript
  // Parent: REQ-0015
  import DOMPurify from 'dompurify';

  // Bad: XSS vulnerability
  function UnsafeComponent({ html }: { html: string }) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
  }

  // Good: Sanitized HTML
  function SafeComponent({ html }: { html: string }) {
    const sanitized = DOMPurify.sanitize(html);
    return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
  }
  ```

**CSRF Protection:**
- Use CSRF tokens for state-changing requests
- Example (Express):
  ```typescript
  // Parent: REQ-0016
  import csrf from 'csurf';
  import cookieParser from 'cookie-parser';

  app.use(cookieParser());
  app.use(csrf({ cookie: true }));

  app.get('/form', (req, res) => {
    res.render('form', { csrfToken: req.csrfToken() });
  });

  app.post('/submit', (req, res) => {
    // CSRF token validated automatically
    res.send('Data processed');
  });
  ```

**Input Validation:**
- Validate all external inputs (Zod, Yup, or manual)
- Example:
  ```typescript
  // Parent: REQ-0017
  import { z } from 'zod';

  const userSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(100),
    name: z.string().min(1).max(100),
  });

  export function validateUser(data: unknown) {
    return userSchema.parse(data); // Throws if invalid
  }

  export function validateUserSafe(data: unknown) {
    const result = userSchema.safeParse(data);
    if (!result.success) return { error: result.error.errors };
    return { data: result.data };
  }
  ```

**Secrets Management:**
- Use environment variables (never commit `.env` files)
- Example:
  ```typescript
  // Parent: REQ-0018
  // .env.example (commit this)
  DATABASE_URL=postgresql://localhost:5432/mydb
  JWT_SECRET=your-secret-here

  // config.ts
  export const config = {
    databaseUrl: process.env.DATABASE_URL!,
    jwtSecret: process.env.JWT_SECRET!,
  };

  // Validate at startup
  if (!config.databaseUrl || !config.jwtSecret) {
    throw new Error('Missing required environment variables');
  }
  ```

**npm Audit:**
- Run `npm audit` before deployment
- Fix high/critical vulnerabilities
- Document exceptions in Build Manifest notes

**Escalation Rule:**
- Any auth, permission, token, session, or identity change = L2+ risk level (see `docs/agile-v-runtime/04_RISK_CLASSIFICATION.md`)

**Secure Coding (inherited from build-agent + JS/TS-specific):**
1. Input validation (Zod, Yup, or manual validation)
2. Error handling (explicit try/catch, custom error classes)
3. No hardcoded secrets (use environment variables)
4. Parameterized queries (ORM or prepared statements)
5. Bounded operations (pagination on all list endpoints, query timeouts)
6. Least privilege (role-based access control, middleware guards)
7. Dependency awareness (`npm audit` before deployment)

---

### 7. Testing Strategy

**Jest/Vitest Unit Tests:**
- Use Vitest for Vite projects, Jest for others
- Example:
  ```typescript
  // Parent: REQ-0019
  import { describe, it, expect } from 'vitest';
  import { AuthService } from './auth.service';

  describe('AuthService', () => {
    it('should authenticate user with valid credentials', async () => {
      const authService = new AuthService();
      const user = await authService.authenticate('test@example.com', 'password');
      expect(user).toBeDefined();
      expect(user?.email).toBe('test@example.com');
    });

    it('should return null for invalid credentials', async () => {
      const authService = new AuthService();
      const user = await authService.authenticate('test@example.com', 'wrong');
      expect(user).toBeNull();
    });
  });
  ```

**React Testing Library:**
- Test user behavior, not implementation details
- Example:
  ```typescript
  // Parent: REQ-0020
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';
  import { LoginForm } from './LoginForm';

  describe('LoginForm', () => {
    it('should submit form with valid credentials', async () => {
      const onSubmit = vi.fn();
      render(<LoginForm onSubmit={onSubmit} />);

      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /login/i }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledWith({ email: 'test@example.com', password: 'password123' });
      });
    });
  });
  ```

**E2E Tests (Playwright/Cypress):**
- Test critical user flows
- Example (Playwright):
  ```typescript
  // Parent: REQ-0021
  import { test, expect } from '@playwright/test';

  test('user can login and view dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'password123');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');
  });
  ```

**Coverage Targets:**
- From REQ acceptance criteria
- Use `vitest --coverage` or `jest --coverage`

**Bug Fixes:**
- Regression test required (see test-designer + red-team-verifier)
- Test must fail before fix, pass after fix

**Alignment:** Test Designer (TC-XXXX) defines tests; Build Agent structures code for testability (dependency injection, custom hooks, etc.).

---

### 8. Build Tools and Configuration

**Vite Configuration:**
- Modern build tool for frontend projects
- Example:
  ```typescript
  // Parent: REQ-0022
  // vite.config.ts
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import path from 'path';

  export default defineConfig({
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          },
        },
      },
    },
  });
  ```

**ESLint Configuration:**
- Enforce code quality and consistency
- Example:
  ```javascript
  // Parent: REQ-0023
  // .eslintrc.cjs
  module.exports = {
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:react/recommended',
      'plugin:react-hooks/recommended',
    ],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'react', 'react-hooks'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  };
  ```

**Traceability:** Document build configuration decisions in Build Manifest notes with REQ justification.

---

## Evidence Requirements

Inherits the L0-L4 framework from `docs/agile-v-runtime/04_RISK_CLASSIFICATION.md`. JavaScript/TypeScript-specific additions below; legacy R0-R3 maps as documented there.

### L0: Exploratory
Base evidence applies (short result summary, no production credentials, no production code path changed).

**JS/TS-Specific:** No additions.

---

### L1: Routine
Base evidence applies (affected files, diff summary, targeted tests or explanation, lint/typecheck, residual-risk note).

**JS/TS-Specific Additions:**
- **TypeScript compilation:** `tsc --noEmit` output (if TypeScript)
- **Linting:** `eslint` output
- **Tests:** `jest` or `vitest` output for affected modules

---

### L2: Production
Base evidence applies (task brief with REQ IDs, implementation plan, affected files, executed commands, test results, regression coverage, acceptance criteria → test mapping, security/static check, rollback path, reviewer decision).

**JS/TS-Specific Additions:**
- **E2E tests:** Playwright or Cypress test results for affected user flows
- **Dependencies:** `npm audit` results (no high/critical vulnerabilities)
- **Bundle size:** Bundle analysis for frontend changes (document tool: `vite-bundle-visualizer`, `webpack-bundle-analyzer`)
- **API changes:** API documentation updated (OpenAPI, JSDoc, or README)
- **Performance:** Lighthouse scores for frontend changes (performance, accessibility, best practices, SEO)
- **Auth/security changes:** Security review notes, auth flow E2E tests

---

### L3/L4: High Assurance
Base evidence applies (all `L2` evidence + independent verification agent review, traceability matrix, explicit human sign-off, audit artifact, release decision rationale).

**JS/TS-Specific Additions:**
- **Security:** OWASP Top 10 checklist completed, security scan results (`npm audit`, Snyk, or similar)
- **Performance:** Load test results for affected endpoints (document tool: k6, artillery, etc.)
- **Accessibility:** WCAG 2.1 AA compliance audit (axe-core, Lighthouse, manual testing)
- **Browser compatibility:** Cross-browser testing results (BrowserStack, Sauce Labs, or manual)
- **Traceability:** REQ-XXXX → ART-XXXX → TC-XXXX → Evidence mapping in ATM.md

---

## Halt Conditions

Halt and do not emit when:

**Inherited from build-agent:**
- Ambiguous REQ (requirement unclear or contradictory)
- Missing REQ link (artifact has no traceable parent requirement)
- Physical constraint violation (hardware, network, or infrastructure limits exceeded)
- Conflict with approved Blueprint (contradicts Human Gate 1 approved design)

**JS/TS-Specific:**
- **TypeScript errors in production build** (`tsc` fails for L2+ tasks without documented exceptions)
- **Security vulnerabilities** (high/critical npm audit findings without documented exception)
- **XSS vulnerability** (`dangerouslySetInnerHTML` without sanitization or justification)
- **CSRF vulnerability** (state-changing endpoints without CSRF protection)
- **Missing input validation** (API endpoints accept unvalidated user input)
- **Secrets in client-side code** (API keys, tokens, passwords in frontend bundles)
- **Auth change without L2+ risk classification** (authentication, authorization, or session logic changed below L2)
- **Bundle size explosion** (frontend bundle size increases >20% without documented justification)
- **eval() usage** (`eval()` or `Function()` constructor without documented justification)

**Halt Protocol:**
1. Stop synthesis immediately
2. Emit Evidence Summary with HALT condition flagged
3. Present specific issue to Human (e.g., "XSS vulnerability detected: dangerouslySetInnerHTML without sanitization in UserProfile.tsx")
4. Wait for Human resolution (refactor, clarify REQ, approve exception)
5. Resume only after Human Gate cleared

---

## Context Engineering

Inherited from build-agent + these JavaScript/TypeScript considerations:

1. **node_modules:** Never load into context. Reference package names/versions from `package.json` only.
2. **Lock files:** Never load `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` into context. Reference versions from `package.json` only.
3. **Bundle configs:** Vite, Webpack, Rollup configs should be read from disk per-artifact, not carried across builds.
4. **Monorepo packages:** Treat each package as separate context scope. Do not load all packages into a single agent's context.
5. **Generated types:** GraphQL codegen, Prisma client, tRPC router types → reference by import path, do not load contents into context.
6. **Build outputs:** `dist/`, `build/`, `.next/` → never load into context. Reference by path only.

**Pre-Execution Validation (inherited from build-agent):**
Before synthesis, validate:
1. **Input eligibility:** Every in-scope REQ is approved AND baselined; record REQ revision and baseline ID.
2. **Requirement coverage:** Every in-scope REQ has ≥1 artifact planned
3. **Artifact completeness:** Components, hooks, services, types, tests, API routes (if applicable), each with `artifact -> implements -> baselined requirement` lineage
4. **Dependency order:** No circular imports between modules (analyze imports)
5. **Scope sanity:** Feature scope fits ≤50% context (split to sub-agents if needed)
6. **Interface contracts:** Document module exports before synthesis (e.g., AuthService exports authenticate, createToken)

**Halt if any validation fails.**

---

## Output Format

Same as build-agent: Build Manifest with `ARTIFACT_ID | REQ_ID@REVISION | BASELINE_ID | implements | LOCATION | NOTES`.

**Example JavaScript/TypeScript Build Manifest:**
```
BUILD_MANIFEST.md

Cycle: C1
Task: REQ-0001 - User authentication via JWT
Risk Level: L2
Generated: 2026-05-22T10:00:00Z

ART-0001 | REQ-0001 | src/features/auth/components/LoginForm.tsx | Login form component; Zod validation
ART-0002 | REQ-0001 | src/features/auth/hooks/useAuth.ts | Auth hook; React Query for login/logout
ART-0003 | REQ-0001 | src/features/auth/services/authService.ts | Auth service; JWT token handling
ART-0004 | REQ-0001 | src/features/auth/types/auth.ts | TypeScript types for auth
ART-0005 | REQ-0001 | app/api/auth/login/route.ts | Next.js API route for login
ART-0006 | REQ-0001 | src/features/auth/components/LoginForm.test.tsx | Unit tests for LoginForm (5 scenarios)
ART-0007 | REQ-0001 | e2e/auth.spec.ts | E2E tests for login flow (3 scenarios)
```

**Per-file traceability header:**
```typescript
// Parent: REQ-0001
// AC1: POST /api/auth/login returns access token on valid credentials
// AC2: Invalid credentials return 401
```

---

## When to Use

**Project Types:**
- Web applications (SPA, SSR, static)
- Node.js backends and APIs
- Frontend components and libraries
- Full-stack applications (Next.js, Remix)
- React Native mobile apps
- Electron desktop apps

**Auto-Trigger Hints (for agent routing):**

**package.json dependencies:**
- `react`
- `next`
- `vue`
- `svelte`
- `express`
- `fastify`
- `@nestjs/core` (defer to build-agent-nestjs if present)
- `typescript`

**File patterns:**
- `**/*.ts`
- `**/*.tsx`
- `**/*.js`
- `**/*.jsx`
- `**/package.json`
- `**/tsconfig.json`
- `**/vite.config.ts`
- `**/next.config.js`

**Task keywords:**
- "React"
- "Next.js"
- "TypeScript"
- "JavaScript"
- "frontend"
- "web app"
- "API"
- "Node.js"
- "Express"
- "Fastify"
- "component"
- "hook"
- "route"
