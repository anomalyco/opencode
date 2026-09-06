# Example Output: System Overview

This is the expected output from `system-understanding-agent` for CR-001 (rate limiting).

---

# System Overview

## Source

- Repository: `my-org/auth-service`
- Knowledge graph path: `.understand-anything/knowledge-graph.json`
- Graph hash: `sha256:a3f2c1d9e847b650f3c2a1d8e9f0b341c6d7e2a8b9f1c0d3e5a2b7f4c6d9e1a2`
- Generated at: `2026-05-26T09:00:00Z`

## Summary

`auth-service` is a NestJS REST API that handles user authentication (login, logout, token
refresh) and session management for the `my-org` platform. It is consumed by the frontend
application and several internal microservices.

## Main Architectural Layers

| Layer | Components | Notes |
|---|---|---|
| API | `AuthController`, `SessionController` | REST endpoints under `/auth/` and `/session/` |
| Service | `AuthService`, `SessionService`, `TokenService` | Business logic; stateless |
| Data | `UserRepository`, `SessionRepository` | TypeORM repositories; PostgreSQL |
| Guard | `JwtAuthGuard`, `RolesGuard` | NestJS guards for auth and RBAC |
| Utility | `HashingService`, `ConfigService` | Bcrypt, env config |

## Key Entry Points

| Entry point | Type | Purpose |
|---|---|---|
| `POST /auth/login` | endpoint | Authenticate user, return JWT |
| `POST /auth/logout` | endpoint | Invalidate session |
| `POST /auth/refresh` | endpoint | Refresh expired token |
| `GET /session/me` | endpoint | Return current session info |

## Key Dependencies

| Component | Depends on | Risk |
|---|---|---|
| `AuthService` | `UserRepository`, `HashingService` | Medium — DB dependency |
| `TokenService` | `ConfigService` (JWT secret) | High — secret rotation required |
| `SessionRepository` | PostgreSQL | High — data persistence |

## Domain Flows

| Flow | Components | Notes |
|---|---|---|
| Login | `AuthController` → `AuthService` → `UserRepository` → `TokenService` | Primary business flow |
| Token refresh | `SessionController` → `SessionService` → `TokenService` | Auto-refresh on expiry |
| Logout | `AuthController` → `AuthService` → `SessionRepository` | Invalidates DB session |

## Known Constraints

- JWT secret must be rotated manually; no automated rotation in current version.
- Sessions are stored in PostgreSQL; Redis is not used for session caching.
- No rate limiting exists on any endpoint as of this graph snapshot.

## Areas Requiring Caution

- `TokenService` — directly handles JWT signing; changes here affect all authenticated flows.
- `HashingService` — bcrypt rounds are hardcoded; any change requires regression testing.
- `UserRepository` — shared by multiple services; schema changes have wide impact.

## Unknowns / Missing Context

- No architecture docs beyond the graph and README.
- Load testing data is not available; rate limit thresholds are based on product requirements.

## Confidence

- Confidence: **High**
- Reason: The graph covers all identified entry points and the change is scoped to a
  well-defined endpoint. No ambiguous dependencies detected.
