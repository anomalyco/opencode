# Plan: OpenCode Serve Multi-Tenant Skill Management

> Source PRD: https://github.com/xingyun0812/opencode/issues/1

## Architectural Decisions

Durable decisions that apply across all phases:

- **Auth strategy**: JWT (HS256/RS256) coexists with existing Basic Auth. If JWT is present, it must be valid (401 on invalid/expired). If JWT is absent, fall back to Basic Auth. Invalid JWT must NOT silently downgrade.
- **UserContext layer**: Defined in `packages/schema/src/user-context.ts` (Schema layer) as an Effect Service tag, referenced by both Core and Server. This avoids circular dependencies.
- **Database**: SQLite via Drizzle ORM (built-in, `bun:sqlite` / `node:sqlite`). Schema defined with Drizzle ORM, which abstracts the driver — same schema code works for SQLite and PostgreSQL. Switch requires only a driver swap.
- **Skill storage**: Filesystem (`.md` files with frontmatter), organized by scope directories. Shared filesystem (NFS/EFS) for multi-server.
- **Permission composition**: User-level RBAC controls "can see/manage" (API layer). Agent-level permissions control "can execute at runtime" (Agent layer). Both must pass — AND relationship.
- **Session identity**: Skills identified by `name` (directory name). No separate ID field.
- **Role model**: JWT carries `permissions: string[]` claims rather than hardcoded roles, allowing future extensibility.
- **Document storage**: User-uploaded documents are managed by the Java/React dashboard layer, not by opencode serve. Only Skill files are stored by opencode.

---

## Phase 1: User Identity + Session Ownership

**User stories**: #1, #2, #3, #4, #5, #6, #7, #8, #9

### What to build

A vertical slice through:

**Layer A — UserContext Service + JWT Auth Middleware:**
1. Define `UserContext` type and Effect Service tag in Schema layer (`packages/schema/src/user-context.ts`)
2. Implement JWT validation logic (decode, verify signature, extract claims)
3. New middleware that detects `Authorization: Bearer <jwt>`, validates it, and injects `UserContext` into the Effect request context
4. Coexist with existing Basic Auth middleware (JWT present → validate; JWT absent → Basic Auth fallback; invalid JWT → 401)
5. Write an integration test that sends a request with a valid JWT and verifies `UserContext.Service.get()` returns the correct user info

**Layer B — Session Ownership:**
6. Add `user_id TEXT NOT NULL` and `user_department_code TEXT` columns to the Session table (Drizzle ORM schema migration)
7. Update `session.create` to capture `UserContext.userID` and `UserContext.departmentCode` at creation time
8. Update `session.list` to filter by user identity (user → own sessions; dept_admin → own department; global_admin → all)
9. Update `session.get`, `session.prompt`, `session.interrupt` to verify the requesting user owns the session
   - `session.prompt` returns 404 for non-owner (hides existence of other users' sessions — prevents session ID enumeration)
   - `session.interrupt` returns 403 for non-owner (caller already knows the session exists, so 403 provides clearer feedback)
10. Handle the edge case: sessions with null `departmentCode` are visible only to the owner and global_admin

All filtering and ownership checks happen in the server handler layer, using `UserContext`. The protocol definitions only add optional query parameters for filtering.

### Acceptance criteria

- [ ] `UserContext.Service.get()` returns decoded user info when valid JWT is provided
- [ ] Invalid/expired JWT returns 401 without falling back to Basic Auth
- [ ] Requests without JWT continue to work via existing Basic Auth
- [ ] JWT secret key is configurable via environment variable
- [ ] Integration test: request with valid JWT → UserContext correctly populated
- [ ] Unit tests for JWT validation (valid, expired, invalid signature, malformed)
- [ ] New sessions are tagged with the authenticated user's ID and department code
- [ ] User sees only their own sessions in `GET /api/session`
- [ ] Dept admin sees own + same-department sessions
- [ ] Global admin sees all sessions
- [ ] `session.prompt` returns 404 for non-owner (don't reveal existence of other users' sessions)
- [ ] `session.interrupt` returns 403 for non-owner (caller already knows session exists)
- [ ] Sessions with null `departmentCode` are NOT exposed to dept_admin queries
- [ ] Existing sessions without user_id (migration) handled gracefully
- [ ] Integration tests for session filtering and owner validation
- [ ] Existing tests pass unchanged

---

## Phase 2: Skill Scope — Type Definition + List Filtering

**User stories**: #10, #11, #12, #13, #20

### What to build

A vertical slice through:
1. Define `SkillScope` type in Schema layer (packages/schema/src/skill.ts):
   ```typescript
   interface SkillScope {
     type: "global" | "department" | "user"
     departmentCode?: string  // when type === "department"
     userID?: string          // when type === "user"
   }
   ```
2. Add `scope: SkillScope` field to `Skill.Info`
3. Update `SkillV2.Service.list()` to accept an optional `UserContext` parameter and filter by scope:
   - `global` → all users
   - `department` → user's departmentCode matches
   - `user` → user's userID matches
4. Update the skill discovery/loading logic (in DirectorySource) to parse scope from directory structure:
   - The `DirectorySource` glob pattern currently treats each subdirectory as a skill name. It must be updated to recognize `global/`, `dept_<code>/`, `user_<id>/` as scope parent directories and skip them — only their children are skills.
   - Scope parsing rules:
     - `global/<name>/` → `{type: "global"}`
     - `dept_<code>/<name>/` → `{type: "department", departmentCode: "<code>"}`
     - `user_<id>/<name>/` → `{type: "user", userID: "<id>"}`
     - Top-level skills (no scope directory) → `{type: "global"}` (backward compatible)
5. Wire `GET /api/skill` to use the filtered list based on the authenticated user

This phase does NOT yet add CRUD endpoints — only read-side filtering. Skills are still managed via filesystem.

### Acceptance criteria

- [ ] Global admin sees all skills regardless of scope
- [ ] Dept admin sees global + own-department skills
- [ ] User sees global + own personal skills
- [ ] User cannot see other departments' skills
- [ ] User cannot see other users' personal skills
- [ ] Legacy flat skills (no scope directory) default to `global` visibility
- [ ] `GET /api/skill` returns only authorized skills for the authenticated user
- [ ] Unit tests for all scope filtering scenarios

---

## Phase 3: Skill CRUD API

**User stories**: #14, #15, #16, #17, #18, #19, #21, #22

### What to build

A vertical slice through:
1. Implement scope ownership validation:
   - `global` scope → only users with `skill.manage:global` permission can CRUD
   - `department` scope → only dept_admin of that department (or global_admin) can CRUD
   - `user` scope → only the owning user can CRUD
2. `POST /api/skill` — create a skill
   - Validates scope against user permissions
   - Writes `SKILL.md` file to the corresponding scope directory
   - Triggers skill cache refresh
3. `PUT /api/skill/:name` — update a skill
   - Validates scope ownership against user permissions
   - Updates the `SKILL.md` file
   - Triggers skill cache refresh
4. `DELETE /api/skill/:name` — delete a skill
   - Validates scope ownership
   - Removes the skill directory
   - Triggers skill cache refresh
5. Skill cache invalidation strategy (single-server: immediate refresh; multi-server: short TTL or flush endpoint)
6. Error responses for unauthorized scope access (403), skill not found (404), duplicate name (409)

The GET endpoint was already modified in Phase 2 — this phase adds write operations.

### Acceptance criteria

- [ ] User can create personal skills (`user_<userID>/` directory)
- [ ] Dept admin can create department skills (`dept_<deptCode>/` directory)
- [ ] Global admin can create global skills (`global/` directory)
- [ ] User cannot create skills outside their authorized scope (403)
- [ ] User can edit/delete their own personal skills
- [ ] Dept admin can edit/delete their own department skills (but NOT other departments')
- [ ] Global admin can edit/delete any skill
- [ ] Duplicate skill name within the same scope returns 409
- [ ] Cache is refreshed after each write operation
- [ ] Integration tests for all CRUD + scope validation scenarios

---

## Phase 4: Agent Permission Composition

**User stories**: #21 (runtime enforcement)

> **Note**: This phase is intentionally thin. It can be delivered concurrently with Phase 3 since they touch independent code paths (Agent config vs Skill API).

### What to build

A vertical slice through:
1. Update all built-in Agent configurations (build, plan, explore) to include `skill:* = allow` in their permission rulesets
2. Ensure the permission composition logic is wired: when an Agent executes the `skill` tool, both user-level scope (from Phase 2) AND agent-level `skill:<name>` rule must pass
3. Document the permission flow for operators who customize Agent configurations

This phase is intentionally thin — it closes the loop on runtime permission enforcement. The user-level RBAC (Phase 2-3) is the primary gate; Agent permissions are the secondary gate at execution time.

### Acceptance criteria

- [ ] All built-in agents have `skill:* = allow` in their default config
- [ ] Agent execution of skill tool checks both user-level scope AND agent-level permission
- [ ] User who can see a skill (passes scope filter) but uses an agent with `skill:* = deny` gets a blocked error
- [ ] Custom Agent configurations can override the default `skill:* = allow` rule

---

## Phase 5: Multi-Server Deployment + PostgreSQL Migration (future)

**User stories**: #23, #24, #25, #26

> **Note**: This phase is deferred until the system reaches the scale where SQLite becomes a bottleneck (>50 concurrent users). The schema and code changes from Phases 1-4 are all designed to be database-agnostic.

### What to build

A vertical slice through:
1. Swap SQLite driver for PostgreSQL driver (Drizzle ORM handles the schema translation — runtime query code works unchanged)
2. Regenerate Drizzle migration files for PostgreSQL dialect (`drizzle-kit generate` with `pg` driver produces different SQL DDL)
3. Add connection string configuration via environment variable
4. Run schema migrations against PostgreSQL
5. Deploy shared filesystem (NFS/EFS) for skill storage
6. Implement cross-server cache invalidation (Redis Pub/Sub or short TTL)
7. Document deployment architecture for multi-server operation

### Acceptance criteria

- [ ] All existing functionality works against PostgreSQL
- [ ] Schema migration runs automatically on server start
- [ ] Multiple server instances can operate against the same database
- [ ] Skill cache is consistent across servers (within configured tolerance)
- [ ] Deployment documentation is complete