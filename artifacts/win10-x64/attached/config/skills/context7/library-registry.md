# External Library Registry

## Purpose

This file lists external libraries/frameworks that should use **ExternalScout** (via Context7) for live documentation instead of relying on potentially outdated training data.

## When to Use This

**ContextScout** checks this list when:
1. User asks about a library/framework
2. No internal context exists in `/Users/apple/.config/opencode/context/development/frameworks/`
3. Query matches a library name below

**Action**: Recommend **ExternalScout** subagent

---

## Supported Libraries

### Database & ORM

#### Drizzle ORM
- **Aliases**: `drizzle`, `drizzle-orm`, `drizzle orm`
- **Docs**: https://orm.drizzle.team/
- **Context7**: `use context7 for drizzle`
- **Common topics**: schema organization, migrations, relational queries, transactions, TypeScript types

#### Prisma
- **Aliases**: `prisma`
- **Docs**: https://www.prisma.io/docs
- **Context7**: `use context7 for prisma`
- **Common topics**: schema, migrations, client, relations, TypeScript

---

### Authentication

#### Better Auth
- **Aliases**: `better-auth`, `better auth`, `betterauth`
- **Docs**: https://www.better-auth.com/docs
- **Context7**: `use context7 for better-auth`
- **Common topics**: Next.js integration, Drizzle adapter, social providers, session management, 2FA

#### NextAuth.js
- **Aliases**: `nextauth`, `next-auth`, `nextauth.js`
- **Docs**: https://next-auth.js.org/
- **Context7**: `use context7 for nextauth`
- **Common topics**: providers, callbacks, sessions, JWT

#### Clerk
- **Aliases**: `clerk`
- **Docs**: https://clerk.com/docs
- **Context7**: `use context7 for clerk`
- **Common topics**: authentication, user management, organizations

---

### Frontend Frameworks

#### Next.js
- **Aliases**: `nextjs`, `next.js`, `next`
- **Docs**: https://nextjs.org/docs
- **Context7**: `use context7 for nextjs`
- **Common topics**: App Router, Server Actions, Server Components, routing, middleware, API routes

#### React
- **Aliases**: `react`, `reactjs`, `react.js`
- **Docs**: https://react.dev/
- **Context7**: `use context7 for react`
- **Common topics**: hooks, components, state, effects, context

#### TanStack Query
- **Aliases**: `tanstack query`, `react query`, `@tanstack/react-query`
- **Docs**: https://tanstack.com/query/latest
- **Context7**: `use context7 for tanstack query`
- **Common topics**: useQuery, useMutation, prefetching, caching, Server Components

#### TanStack Router
- **Aliases**: `tanstack router`, `@tanstack/react-router`
- **Docs**: https://tanstack.com/router/latest
- **Context7**: `use context7 for tanstack router`
- **Common topics**: routing, type-safe routes, loaders, navigation

#### TanStack Start
- **Aliases**: `tanstack start`, `@tanstack/start`
- **Docs**: https://tanstack.com/start/latest
- **Context7**: `use context7 for tanstack start`
- **Common topics**: full-stack setup, server functions, file routing

---

### Infrastructure & Deployment

#### Cloudflare Workers
- **Aliases**: `cloudflare workers`, `cloudflare`, `workers`, `cf workers`
- **Docs**: https://developers.cloudflare.com/workers
- **Context7**: `use context7 for cloudflare workers`
- **Common topics**: routing, KV storage, Durable Objects, bindings, middleware

#### AWS Lambda
- **Aliases**: `aws lambda`, `lambda`, `aws λ`
- **Docs**: https://docs.aws.amazon.com/lambda
- **Context7**: `use context7 for aws lambda`
- **Common topics**: handlers, layers, environment variables, triggers, TypeScript

#### Vercel
- **Aliases**: `vercel`
- **Docs**: https://vercel.com/docs
- **Context7**: `use context7 for vercel`
- **Common topics**: deployment, environment variables, edge functions, serverless

---

### UI Libraries & Styling

#### Shadcn/ui
- **Aliases**: `shadcn`, `shadcn/ui`, `shadcn-ui`
- **Docs**: https://ui.shadcn.com/
- **Context7**: `use context7 for shadcn`
- **Common topics**: components, installation, theming, customization

#### Radix UI
- **Aliases**: `radix`, `radix ui`, `radix-ui`, `@radix-ui`
- **Docs**: https://www.radix-ui.com/
- **Context7**: `use context7 for radix`
- **Common topics**: primitives, accessibility, composition

#### Tailwind CSS
- **Aliases**: `tailwind`, `tailwindcss`, `tailwind css`
- **Docs**: https://tailwindcss.com/docs
- **Context7**: `use context7 for tailwind`
- **Common topics**: configuration, utilities, responsive design, dark mode

---

### State Management

#### Zustand
- **Aliases**: `zustand`
- **Docs**: https://zustand-demo.pmnd.rs/
- **Context7**: `use context7 for zustand`
- **Common topics**: store creation, selectors, middleware, TypeScript

#### Jotai
- **Aliases**: `jotai`
- **Docs**: https://jotai.org/
- **Context7**: `use context7 for jotai`
- **Common topics**: atoms, async atoms, utilities

---

### Validation & Forms

#### Zod
- **Aliases**: `zod`
- **Docs**: https://zod.dev/
- **Context7**: `use context7 for zod`
- **Common topics**: schema validation, TypeScript inference, parsing, refinements

#### React Hook Form
- **Aliases**: `react hook form`, `react-hook-form`, `rhf`
- **Docs**: https://react-hook-form.com/
- **Context7**: `use context7 for react hook form`
- **Common topics**: register, validation, errors, TypeScript

---

### Testing

#### Vitest
- **Aliases**: `vitest`
- **Docs**: https://vitest.dev/
- **Context7**: `use context7 for vitest`
- **Common topics**: configuration, testing, mocking, coverage

#### Playwright
- **Aliases**: `playwright`
- **Docs**: https://playwright.dev/
- **Context7**: `use context7 for playwright`
- **Common topics**: browser automation, testing, selectors, assertions

---

## Detection Patterns

ContextScout and ExternalScout should match queries containing:
- Library name (case-insensitive)
- Common variations (e.g., "next.js" vs "nextjs")
- Package names (e.g., "@tanstack/react-query")

**Examples**:
- "How do I use **Drizzle** with PostgreSQL?" → Match: Drizzle ORM
- "Show me **Next.js** App Router setup" → Match: Next.js
- "**TanStack Query** with Server Components" → Match: TanStack Query
- "**Better Auth** integration" → Match: Better Auth

---

## Query Optimization Patterns

### Drizzle ORM

| User Intent | Optimized Query |
|-------------|-----------------|
| Setup/Installation | `PostgreSQL+setup+configuration+TypeScript+installation` |
| Modular schemas | `modular+schema+organization+domain+driven+design` |
| Relations | `relational+queries+one+to+many+joins+with+relations` |
| Migrations | `drizzle-kit+migrations+generate+push+PostgreSQL` |
| Transactions | `database+transactions+patterns+TypeScript` |
| Type safety | `TypeScript+type+inference+schema+types+inferInsert` |

### Better Auth

| User Intent | Optimized Query |
|-------------|-----------------|
| Setup | `setup+configuration+Next.js+TypeScript+installation` |
| Next.js integration | `Next.js+App+Router+integration+setup+configuration` |
| Drizzle adapter | `Drizzle+adapter+PostgreSQL+schema+generation+configuration` |
| Social providers | `social+providers+OAuth+GitHub+Google+setup` |
| Email/password | `email+password+authentication+signup+signin` |
| Session management | `session+management+cookies+JWT+middleware` |

### Next.js

| User Intent | Optimized Query |
|-------------|-----------------|
| App Router | `App+Router+file+conventions+layouts+pages+routing` |
| Server Actions | `Server+Actions+form+mutations+revalidation+TypeScript` |
| Server Components | `React+Server+Components+async+data+fetching+patterns` |
| Dynamic routes | `dynamic+routes+params+TypeScript+generateStaticParams` |
| Middleware | `middleware+authentication+redirects+headers+cookies` |
| API routes | `API+routes+route+handlers+TypeScript+POST+GET` |

### TanStack Query

| User Intent | Optimized Query |
|-------------|-----------------|
| Setup | `setup+QueryClient+provider+Next.js+TypeScript` |
| Data fetching | `useQuery+data+fetching+TypeScript+patterns+async` |
| Mutations | `useMutation+optimistic+updates+invalidation+TypeScript` |
| Prefetching | `prefetchQuery+Server+Components+hydration+Next.js` |
| Caching | `cache+configuration+staleTime+gcTime+invalidation` |

### Cloudflare Workers

| User Intent | Optimized Query |
|-------------|-----------------|
| Setup | `getting+started+setup+TypeScript+wrangler+configuration` |
| Routing | `routing+itty-router+hono+request+handling` |
| KV storage | `KV+storage+key+value+bindings+TypeScript` |
| Durable Objects | `Durable+Objects+state+WebSockets+coordination` |

### AWS Lambda

| User Intent | Optimized Query |
|-------------|-----------------|
| Setup | `getting+started+setup+TypeScript+handler+configuration` |
| Handlers | `handler+function+event+context+TypeScript+patterns` |
| Layers | `layers+dependencies+shared+code+deployment` |
| Environment variables | `environment+variables+secrets+configuration+SSM` |

---

## Adding New Libraries

To add a new library:
1. Add entry under appropriate category
2. Include: Name, aliases, docs link, Context7 command, common topics
3. (Optional) Add query optimization patterns
4. Update ExternalScout if needed (usually automatic)

**Template**:
```markdown
#### Library Name
- **Aliases**: `alias1`, `alias2`, `package-name`
- **Docs**: https://example.com/docs
- **Context7**: `use context7 for library-name`
- **Common topics**: topic1, topic2, topic3
```

---

## Usage by ExternalScout

ExternalScout uses this file to:
1. **Detect** which library the user is asking about
2. **Load** query optimization patterns for that library
3. **Build** optimized Context7 queries
4. **Fetch** live documentation
5. **Return** filtered, relevant results
