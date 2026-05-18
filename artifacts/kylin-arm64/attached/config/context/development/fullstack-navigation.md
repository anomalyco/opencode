<!-- Context: development/navigation | Priority: low | Version: 1.0 | Updated: 2026-02-15 -->

# Full-Stack Development Navigation

**Scope**: End-to-end application development

---

## Common Stacks

### MERN (MongoDB, Express, React, Node)
```
Frontend: development/frontend/react/ [future]
Backend:  development/backend/nodejs/express-patterns.md [future]
Data:     development/data/nosql-patterns/mongodb.md [future]
API:      development/backend/api-patterns/rest-design.md [future]
```

### T3 Stack (Next.js, tRPC, Prisma, Tailwind)
```
Frontend: development/frontend/react/ + ui/web/ui-styling-standards.md [future]
Backend:  development/backend/nodejs/ + api-patterns/trpc-patterns.md [future]
Data:     development/data/orm-patterns/prisma.md [future]
```

### Python Full-Stack (FastAPI + React)
```
Frontend: development/frontend/react/ [future]
Backend:  development/backend/python/fastapi-patterns.md [future]
Data:     development/data/sql-patterns/ or nosql-patterns/ [future]
API:      development/backend/api-patterns/rest-design.md [future]
```

---

## Quick Routes

| Layer | Navigate To |
|-------|-------------|
| **Frontend** | `ui-navigation.md` |
| **Backend** | `backend-navigation.md` |
| **Data** | `data/navigation.md` [future] |
| **Integration** | `integration/navigation.md` [future] |
| **Infrastructure** | `infrastructure/navigation.md` [future] |

---

## Common Workflows

**New API endpoint**:
1. `principles/api-design.md` (principles)
2. `backend/api-patterns/rest-design.md` (approach) [future]
3. `backend/nodejs/express-patterns.md` (implementation) [future]

**New React feature**:
1. `frontend/react/component-architecture.md` (structure) [future]
2. `frontend/react/hooks-patterns.md` (logic) [future]
3. `ui/web/ui-styling-standards.md` (styling)

**Database integration**:
1. `data/sql-patterns/` or `data/nosql-patterns/` (approach) [future]
2. `data/orm-patterns/` (if using ORM) [future]
3. `backend/nodejs/` or `backend/python/` (implementation) [future]

**Third-party service**:
1. `integration/third-party-services/` (patterns) [future]
2. `integration/api-integration/` (consuming APIs) [future]

---

## Related Context

- **Clean Code** → `principles/clean-code.md`
- **API Design** → `principles/api-design.md`
- **Core Standards** → `../core/standards/navigation.md`
