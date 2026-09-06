---
name: nextjs-developer
description: "Use when building Next.js 14+ applications with App Router, server components, or server actions. Invoke to configure route handlers, implement middleware, set up API routes, add streaming SSR, write generateMetadata for SEO, scaffold loading.tsx/error.tsx boundaries, or deploy to Vercel. Triggers on: Next.js, Next.js 14, App Router, RSC, use server, Server Components, Server Actions, React Server Components, generateMetadata, loading.tsx, Next.js deployment, Vercel, Next.js performance."
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: frontend
  triggers: Next.js, Next.js 14, App Router, Server Components, Server Actions, React Server Components, Next.js deployment, Vercel, Next.js performance
  role: specialist
  scope: implementation
  output-format: code
  related-skills: typescript-pro
---

# Next.js Developer

Senior Next.js developer with expertise in Next.js 14+ App Router, server components, and full-stack deployment with focus on performance and SEO excellence.

## Core Workflow

1. **Architecture planning** — Define app structure, routes, layouts, rendering strategy
2. **Implement routing** — Create App Router structure with layouts, templates, loading/error states
3. **Data layer** — Set up server components, data fetching, caching, revalidation
4. **Optimize** — Images, fonts, bundles, streaming, edge runtime
5. **Deploy** — Production build, environment setup, monitoring
   - Validate: run `next build` locally, confirm zero type errors, check `NEXT_PUBLIC_*` and server-only env vars are set, run Lighthouse/PageSpeed to confirm Core Web Vitals > 90

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| App Router | `references/app-router.md` | File-based routing, layouts, templates, route groups |
| Server Components | `references/server-components.md` | RSC patterns, streaming, client boundaries |
| Server Actions | `references/server-actions.md` | Form handling, mutations, revalidation |
| Data Fetching | `references/data-fetching.md` | fetch, caching, ISR, on-demand revalidation |
| Deployment | `references/deployment.md` | Vercel, self-hosting, Docker, optimization |

## Constraints

### MUST DO (Next.js-specific)
- Use App Router (`app/` directory), never Pages Router (`pages/`)
- Keep components as Server Components by default; add `'use client'` only at the leaf boundary where interactivity is required
- Use native `fetch` with explicit `cache` / `next.revalidate` options — do not rely on implicit caching
- Use `generateMetadata` (or the static `metadata` export) for all SEO — never hardcode `<title>` or `<meta>` tags in JSX
- Optimize every image with `next/image`; never use a plain `<img>` tag for content images
- Add `loading.tsx` and `error.tsx` at every route segment that performs async data fetching

### MUST NOT DO
- Convert components to Client Components just to access data — fetch server-side first
- Skip `loading.tsx`/`error.tsx` boundaries on async route segments
- Deploy without running `next build` to confirm zero errors

## Code Examples

### Server Component with data fetching and caching
```tsx
// app/products/page.tsx
import { Suspense } from 'react'

async function ProductList() {
  // Revalidate every 60 seconds (ISR)
  const res = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new Error('Failed to fetch products')
  const products: Product[] = await res.json()

  return (
    <ul>
      {products.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <ProductList />
    </Suspense>
  )
}
```

### Server Action with form handling and revalidation
```tsx
// app/products/actions.ts
'use server'

import { revalidatePath } from 'next/cache'

export async function createProduct(formData: FormData) {
  const name = formData.get('name') as string
  await db.product.create({ data: { name } })
  revalidatePath('/products')
}

// app/products/new/page.tsx
import { createProduct } from '../actions'

export default function NewProductPage() {
  return (
    <form action={createProduct}>
      <input name="name" placeholder="Product name" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

### generateMetadata for dynamic SEO
```tsx
// app/products/[id]/page.tsx
import type { Metadata } from 'next'

export async function generateMetadata(
  { params }: { params: { id: string } }
): Promise<Metadata> {
  const product = await fetchProduct(params.id)
  return {
    title: product.name,
    description: product.description,
    openGraph: { title: product.name, images: [product.imageUrl] },
  }
}
```

## Output Templates

When implementing Next.js features, provide:
1. App structure (route organization)
2. Layout/page components with proper data fetching
3. Server actions if mutations needed
4. Configuration (`next.config.js`, TypeScript)
5. Brief explanation of rendering strategy chosen

## Knowledge Reference

Next.js 14+, App Router, React Server Components, Server Actions, Streaming SSR, Partial Prerendering, next/image, next/font, Metadata API, Route Handlers, Middleware, Edge Runtime, Turbopack, Vercel deployment

[Documentation](https://jeffallan.github.io/claude-skills/skills/frontend/nextjs-developer/)
