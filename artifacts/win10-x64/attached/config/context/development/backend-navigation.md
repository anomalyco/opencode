<!-- Context: development/navigation | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Backend Development Navigation

**Scope**: Server-side, APIs, databases, auth

---

## Structure

```
development/backend/           # [future]
├── navigation.md
│
├── api-patterns/              # Approach-based
│   ├── rest-design.md
│   ├── graphql-design.md
│   ├── grpc-patterns.md
│   └── websocket-patterns.md
│
├── nodejs/                    # Tech-specific
│   ├── express-patterns.md
│   ├── fastify-patterns.md
│   └── error-handling.md
│
├── python/
│   ├── fastapi-patterns.md
│   └── django-patterns.md
│
├── authentication/            # Functional concern
│   ├── jwt-patterns.md
│   ├── oauth-patterns.md
│   └── session-management.md
│
└── middleware/
    ├── logging.md
    ├── rate-limiting.md
    └── cors.md
```

---

## Quick Routes

| Task | Path |
|------|------|
| **REST API** | `backend/api-patterns/rest-design.md` [future] |
| **GraphQL** | `backend/api-patterns/graphql-design.md` [future] |
| **API design principles** | `principles/api-design.md` |
| **Node.js** | `backend/nodejs/express-patterns.md` [future] |
| **Python** | `backend/python/fastapi-patterns.md` [future] |
| **Auth (JWT)** | `backend/authentication/jwt-patterns.md` [future] |

---

## By Approach

**REST** → `backend/api-patterns/rest-design.md` [future]
**GraphQL** → `backend/api-patterns/graphql-design.md` [future]
**gRPC** → `backend/api-patterns/grpc-patterns.md` [future]

## By Language

**Node.js** → `backend/nodejs/` [future]
**Python** → `backend/python/` [future]

## By Concern

**Authentication** → `backend/authentication/` [future]
**Middleware** → `backend/middleware/` [future]
**Data layer** → `data/` [future]

---

## Related Context

- **API Design Principles** → `principles/api-design.md`
- **Core Standards** → `../core/standards/code-quality.md`
- **Data Patterns** → `data/navigation.md` [future]
