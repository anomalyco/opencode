## Problem Statement

We deploy opencode serve across multiple servers, serving hundreds of users from different departments. Users interact with OpenCode agents through a Java + React dashboard (similar to Hermes Dashboard) for conversations, document upload/generation, and skill management.

The current opencode serve has:
- Only single-password Basic Auth, no user identity or multi-tenant support
- All skills merged into a flat global namespace with no scope/organization isolation
- Session data with no owner tracking, visible to all users
- Permission system limited to agent-level rules with no user/department hierarchy

This makes it impossible to:
- Restrict which skills a specific user or department can see/use
- Allow users to manage their own personal skills
- Allow departments to maintain shared skills
- Ensure users only see their own sessions
- Deploy at scale across multiple servers with consistent auth and data isolation

## Solution

Introduce a three-layer architecture:

**1. User Identity Layer**: JWT issued by the existing Java backend (SSO + RBAC), validated by opencode serve middleware. JWT carries userId, departmentCode, and role.

**2. Skill Hierarchy by Scope**: Organize skills into three scopes — global, department (`dept_<deptCode>`), and user (`user_<userId>`) — with directory-based isolation on the filesystem. Only skills within the user's scope are visible.

**3. Session Ownership**: Every session is tagged with its creator's userId. All session operations (list, get, prompt, interrupt) verify ownership against the authenticated user.

## User Stories

### Authentication & Authorization

1. As a platform administrator, I want opencode serve to validate JWT tokens from my Java backend, so that users are authenticated without managing separate credentials.
2. As a developer, I want to deploy opencode serve without configuring a shared password, so that auth is handled entirely by JWT from the upstream dashboard.
3. As an operator, I want JWT and Basic Auth to coexist during migration, so that existing clients continue working while new clients adopt JWT.
4. As a security engineer, I want the JWT secret key to be configurable via environment variable, so that key rotation follows our standard operational procedures.

### Session Management

5. As a user, I want to see only my own sessions in the session list, so that I am not distracted by other users' conversations.
6. As a user, I want to be unable to view or interact with other users' sessions, so that my conversation data remains private.
7. As a department admin, I want to view sessions created by members of my department, so that I can audit or troubleshoot departmental usage.
8. As a global admin, I want to view all sessions across all users, so that I can monitor overall system health and usage.
9. As a user, I want my session to be tagged with my identity at creation time, so that ownership is established from the first interaction.

### Skill Browsing

10. As a user, I want to see all global skills available to everyone, so that I can use organization-wide best practices.
11. As a user, I want to see skills shared by my department, so that I can follow team-specific workflows and conventions.
12. As a user, I want to see only my own personal skills (not other users'), so that my private guidance remains private.
13. As a user, I want skills from different scopes to be clearly labeled by their origin (global/department/personal), so that I understand which skills apply to me.

### Skill Management

14. As a user, I want to create my own personal skills, so that I can define custom workflows for my recurring tasks.
15. As a user, I want to edit and delete my own personal skills, so that I can maintain my private guidance library.
16. As a department admin, I want to create skills scoped to my department, so that my team can benefit from shared guidance.
17. As a department admin, I want to edit and delete skills in my department, so that I can keep departmental guidance up to date.
18. As a global admin, I want to create, edit, and delete global skills, so that I can maintain organization-wide best practices.
19. As a global admin, I want to manage skills in any department (emergency override), so that I can fix issues when a department admin is unavailable.

### Skill Enforcement

20. As a user, I want to be unable to create or modify skills outside my authorized scope, so that the permission model is consistently enforced.
21. As a user, I want the Agent to only load skills that I am permitted to see, so that skill-based guidance respects access control.
22. As an operator, I want skill scope enforcement at the API level (not just the UI), so that permissions cannot be bypassed by calling the API directly.

### Multi-Server Deployment

23. As an operator, I want to deploy multiple opencode serve instances behind a load balancer, so that the system scales to hundreds of concurrent users.
24. As an operator, I want session data stored in PostgreSQL (not SQLite), so that any server can serve any user's session.
25. As an operator, I want skill files stored on shared filesystem (NFS/EFS), so that all servers see the same skill set.
26. As an operator, I want skill cache invalidation to work across servers (short TTL or explicit flush), so that skill updates take effect promptly.

## Implementation Decisions

### Modules

#### M1: UserContext Service (deep module)
- Encapsulates JWT parsing and validation
- Provides `UserContext` data class: `{userId, username, departmentCode, role}`
- Injected into Effect request context via middleware
- Interface: `UserContext.Service.get()` → `UserContext`
- Testable in isolation: given a valid/invalid/expired JWT, returns correct context or error

#### M2: Session Ownership (medium module)
- Extends session schema with `userId`, `departmentCode` columns
- Wraps existing session CRUD with owner checks
- Interface: extends existing `Session.Service` with ownership validation
- Ownership rules: user → self only; dept_admin → self + same department; global_admin → all

#### M3: Skill Scope (deep module)
- Extends `Skill.Info` with `scope` field (`{type: "global"|"department"|"user", owner?: string}`)
- `list()` accepts `UserContext`, filters by scope visibility rules
- Interface: `SkillV2.Service.list(userContext)` → filtered skills
- Testable in isolation: given a set of skills and a user context, returns correct subset

#### M4: Skill CRUD API (shallow module)
- New REST endpoints: POST/PUT/DELETE `/api/skill`
- Calls M3 for scope validation
- Writes skill files to scoped directories on shared filesystem
- Refreshes skill cache after mutations

#### M5: Auth Middleware (shallow module)
- Coexists with existing Basic Auth middleware
- Detects `Authorization: Bearer <jwt>` → validates via M1
- Skips JWT validation if Basic Auth credentials match server password (migration path)

### Schema Changes

**Session table adds:**
- `user_id TEXT NOT NULL`
- `user_department_code TEXT`

**Skill.Info adds:**
- `scope: { type: "global" | "department" | "user", owner?: string }`

### API Contracts

**New endpoints (all require valid JWT):**

```
POST   /api/skill          # Create skill
  Body: { name, description, content, scope: { type, owner? } }
  Response: 201 { id, name, scope, location }

PUT    /api/skill/:name     # Update skill
  Body: { description?, content?, scope? }
  Response: 200 { id, name, scope, location }

DELETE /api/skill/:name     # Delete skill
  Response: 204 No Content
```

**Modified endpoints:**

```
GET    /api/skill           # Now filters by authenticated user's scopes
  Response: 200 [{ name, description, content, scope, location }, ...]

GET    /api/session         # Now filters by authenticated user's ownership
  Response: 200 { data: [...], cursor: {...} }
```

### Deployment Architecture

| Component | Technology | Scale |
|-----------|-----------|-------|
| Auth | JWT (HS256/RS256) | Shared secret or public key |
| Session DB | SQLite → PostgreSQL | SQLite for <50 users, PG for 50+ |
| Skill storage | Shared filesystem (NFS/EFS) | Read-mostly, low concurrency concern |
| Session affinity | User-hash based routing | Optional, simplifies initial deployment |

## Testing Decisions

### Testing Philosophy

Tests should verify external behavior, not implementation details. For this project:
- Good test: "Given a UserContext with role=user, list() returns only global + personal skills"
- Bad test: "list() calls filter() with the right arguments"

### Modules to Test

**M1 UserContext (comprehensive tests needed):**
- Valid JWT → correct UserContext
- Expired JWT → auth error
- Invalid signature → auth error
- Missing token → fallback to Basic Auth
- Malformed token → graceful error

**M3 Skill Scope (comprehensive tests needed):**
- Global admin sees all skills
- Dept admin sees global + own dept skills
- User sees global + own personal skills
- User cannot see other users' personal skills
- User cannot see other departments' skills
- No-scope (legacy) skills default to global

**M2 Session Ownership (integration tests needed):**
- Session list is filtered by user
- Session prompt rejects non-owner
- Dept admin lists own dept sessions

**M4 Skill CRUD (integration tests needed):**
- Create with valid scope succeeds
- Create outside authorized scope fails (403)
- Delete own skill succeeds
- Delete others' skill fails (403)

### Prior Art in Codebase

The existing `packages/core/test/permission.test.ts` tests demonstrate the permission assertion pattern. The `packages/core/test/tool-skill.test.ts` tests show how to set up `SkillV2.Service` with mock data in a test layer — this pattern should be reused for M3 tests.

## Out of Scope

- Git-based project code operations (users only chat with agents, no code manipulation)
- Real-time collaboration features (multiple users editing the same session)
- Skill version history / rollback
- Audit logging (planned for post-MVP)
- Rate limiting and usage quotas
- OAuth2 / OpenID Connect integration (JWT trust model is sufficient)
- Dashboard UI implementation (this PRD covers the backend API; UI is built by the Java/React team)
- User management endpoints in opencode (user data lives in the Java backend)

## Further Notes

1. **JWT Trust Model**: opencode serve trusts JWTs signed by the Java backend. The shared secret or public key must be distributed to all opencode serve instances via environment variable or config file.

2. **Migration Path**: All changes are backward-compatible. Existing deployments without JWT continue using Basic Auth. Legacy skills (no scope metadata) default to `global` visibility.

3. **Multi-Server Caching**: The `LocationServiceMap` has a 60-minute idle TTL. For multi-server deployments, skill cache TTL should be reduced to 30s, or an explicit invalidation endpoint should be added.

4. **Document Storage**: User-uploaded documents should be stored under `user_<userId>/docs/` directories for natural isolation.
