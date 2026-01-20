# Architecture Patterns: PAM-Based System Authentication

**Domain:** Web application with PAM authentication and multi-user command execution
**Researched:** 2026-01-19
**Overall Confidence:** MEDIUM (based on training knowledge of Cockpit and PAM patterns; WebSearch/WebFetch unavailable for verification)

## Executive Summary

PAM-based web authentication requires a privileged broker architecture where a root-owned process handles authentication and spawns user processes. This is fundamentally different from typical web auth because the goal is not just "who is this user?" but "run this command as this user." The Cockpit project is the canonical reference implementation.

## Recommended Architecture

```
                                    +------------------+
                                    |   Web Browser    |
                                    +--------+---------+
                                             |
                                             | HTTPS (via reverse proxy)
                                             v
+------------------------------------------------------------------------+
|                           HONO SERVER (unprivileged)                   |
|                                                                        |
|  +----------------+    +------------------+    +--------------------+  |
|  | Static Assets  |    |  Session Cookie  |    |   API Routes       |  |
|  | (served as-is) |    |  Middleware      |    |   (check session)  |  |
|  +----------------+    +--------+---------+    +---------+----------+  |
|                                 |                        |             |
+------------------------------------------------------------------------+
                                  |                        |
                                  |  Unix Socket / IPC     |
                                  v                        v
+------------------------------------------------------------------------+
|                      AUTH BROKER (runs as root)                        |
|                                                                        |
|  +-----------------+    +------------------+    +-------------------+  |
|  | PAM Auth        |    | Session-to-UID   |    | Process Spawner   |  |
|  | (pam_authenticate)|  | Mapping          |    | (setuid/setgid)   |  |
|  +-----------------+    +------------------+    +-------------------+  |
|                                                          |             |
+------------------------------------------------------------------------+
                                                           |
                                                           v
                                              +------------------------+
                                              | User Process           |
                                              | (running as target UID)|
                                              | - Shell commands       |
                                              | - File operations      |
                                              | - Tool execution       |
                                              +------------------------+
```

## Component Boundaries

| Component | Responsibility | Runs As | Communicates With |
|-----------|---------------|---------|-------------------|
| Hono Server | HTTP handling, session cookies, route dispatch | Unprivileged user or nobody | Auth Broker via Unix socket |
| Auth Broker | PAM authentication, session-UID mapping, process spawning | root (or setuid binary) | Hono Server, spawned User Processes |
| Session Store | Map session tokens to authenticated UID/GID | Shared (auth broker manages) | Auth Broker reads/writes |
| User Process | Execute commands under authenticated user's identity | Target UID/GID | Auth Broker (parent), PTY for I/O |

### Component Details

#### 1. Hono Server (Web Layer)

**Purpose:** Handle HTTP, serve static assets, manage session cookies, route API requests.

**Key responsibilities:**
- Accept login requests (POST /auth/login with username/password)
- Forward credentials to Auth Broker for PAM verification
- Set/validate session cookies
- Forward authenticated requests to Auth Broker for execution
- Stream responses (SSE) back to client

**Security boundary:**
- Does NOT run as root
- Does NOT handle credentials beyond passing to broker
- Does NOT spawn processes directly
- Validates session cookies but trusts Auth Broker for UID mapping

```typescript
// Conceptual structure
interface SessionCookie {
  sessionID: string;       // Opaque token
  expires: number;         // Cookie expiration
  // UID NOT stored in cookie - broker looks up session -> UID
}

// Auth middleware pattern
app.use(async (c, next) => {
  const sessionID = getCookie(c, 'opencode_session');
  if (!sessionID) {
    return c.redirect('/login');
  }
  // Ask broker to validate session and get user info
  const userInfo = await authBroker.validateSession(sessionID);
  if (!userInfo) {
    return c.redirect('/login');
  }
  c.set('user', userInfo);
  return next();
});
```

#### 2. Auth Broker (Privileged Helper)

**Purpose:** Handle all privilege-sensitive operations - PAM auth, session-UID mapping, process spawning.

**Key responsibilities:**
- Receive credentials from Hono server via Unix socket
- Call PAM for authentication (`pam_authenticate`, `pam_acct_mgmt`)
- Create session entries mapping session token -> (UID, GID, username)
- Spawn processes with correct UID/GID using `setuid`/`setgid`
- Manage process lifecycle (signal forwarding, cleanup)

**Security boundary:**
- Runs as root OR is a setuid binary
- ONLY accepts connections from Hono server (socket permissions)
- Validates all inputs strictly
- Audit logs all authentication attempts

```typescript
// Conceptual broker interface
interface AuthBroker {
  // Authentication
  authenticate(username: string, password: string): Promise<AuthResult>;
  validateSession(sessionID: string): Promise<UserInfo | null>;
  logout(sessionID: string): Promise<void>;

  // Process execution
  spawn(sessionID: string, command: string, args: string[], options: SpawnOptions): Promise<Process>;

  // Session management
  createSession(uid: number, gid: number, username: string): Promise<string>;
  refreshSession(sessionID: string): Promise<void>;
}

interface AuthResult {
  success: boolean;
  sessionID?: string;
  error?: string;
}

interface UserInfo {
  uid: number;
  gid: number;
  username: string;
  homeDir: string;
  shell: string;
}
```

#### 3. Session Store

**Purpose:** Persist session-to-user mappings across restarts.

**Options:**
1. **In-memory Map** - Simplest, sessions lost on restart
2. **File-based** - JSON/SQLite in secure location (root-owned directory)
3. **Shared memory** - Fast, survives process restart if designed carefully

**Recommendation:** File-based SQLite or JSON in `/var/lib/opencode/sessions/` (root-owned, 0600 permissions). Sessions should be short-lived enough that restart clearing is acceptable for MVP.

```typescript
interface SessionEntry {
  id: string;           // Session token (cryptographically random)
  uid: number;          // UNIX UID
  gid: number;          // UNIX GID
  username: string;     // For logging/display
  createdAt: number;    // Timestamp
  expiresAt: number;    // Expiration timestamp
  rememberMe: boolean;  // Longer expiration if true
}
```

#### 4. User Process (Spawned Command Execution)

**Purpose:** Execute actual work under the authenticated user's identity.

**Key behaviors:**
- Runs with correct UID, GID, supplementary groups
- Has correct HOME, USER, SHELL environment
- Working directory set appropriately
- PTY allocated for interactive commands
- I/O proxied back to web client

## Data Flow

### Login Flow

```
1. User submits username/password via HTTPS form
   Browser -> [HTTPS] -> Reverse Proxy -> [HTTP] -> Hono Server

2. Hono forwards credentials to Auth Broker
   Hono Server -> [Unix Socket] -> Auth Broker
   Message: { type: "authenticate", username, password }

3. Auth Broker calls PAM
   Auth Broker -> pam_authenticate() -> PAM stack
   PAM -> /etc/pam.d/opencode (or system-auth)
   PAM may consult: /etc/shadow, LDAP, Kerberos, etc.

4. On success, broker creates session entry
   Auth Broker: session[randomToken] = { uid, gid, username, expires }
   Auth Broker -> Hono: { success: true, sessionID: token }

5. Hono sets session cookie
   Hono -> Browser: Set-Cookie: opencode_session=token; HttpOnly; Secure; SameSite=Strict
```

### Command Execution Flow

```
1. User initiates command (e.g., runs bash tool)
   Browser -> [HTTPS] -> Reverse Proxy -> [HTTP] -> Hono Server
   Request includes: session cookie, command details

2. Hono validates session cookie exists
   Hono extracts sessionID from cookie

3. Hono requests command execution from broker
   Hono -> [Unix Socket] -> Auth Broker
   Message: { type: "spawn", sessionID, command, args, cwd }

4. Broker validates session, looks up UID
   Auth Broker: userInfo = sessions[sessionID]
   Validates: not expired, session exists

5. Broker spawns process as target user
   Auth Broker:
     fork()
     In child:
       setgid(userInfo.gid)
       setgroups(supplementaryGroups)
       setuid(userInfo.uid)
       chdir(workingDirectory)
       exec(command, args)

6. Broker proxies I/O back to Hono
   Auth Broker -> [Unix Socket] -> Hono
   Hono -> [SSE/WebSocket] -> Browser
```

### Logout Flow

```
1. User clicks logout
   Browser -> [HTTPS] -> Hono Server

2. Hono tells broker to invalidate session
   Hono -> [Unix Socket] -> Auth Broker
   Message: { type: "logout", sessionID }

3. Broker removes session entry
   Auth Broker: delete sessions[sessionID]

4. Hono clears cookie
   Hono -> Browser: Set-Cookie: opencode_session=; Max-Age=0
```

## Privilege Model

### Why Root is Required

To spawn processes as arbitrary users, you need one of:

1. **Root process** - Can call `setuid()` to any UID
2. **Setuid binary** - Executable owned by root with setuid bit set
3. **Capabilities** - CAP_SETUID/CAP_SETGID (Linux-specific, finer-grained)

**Recommendation:** Start with a root daemon (Auth Broker). Setuid binaries are harder to secure and capabilities add complexity. Cockpit uses a root daemon (`cockpit-ws`).

### Privilege Separation Model

```
+-----------------+     +-------------------+     +------------------+
| UNPRIVILEGED    |     | PRIVILEGED        |     | USER CONTEXT     |
|                 |     |                   |     |                  |
| Hono Server     | --> | Auth Broker       | --> | Spawned Process  |
| - Web handling  |     | - PAM calls       |     | - Runs as user   |
| - Cookie mgmt   |     | - setuid/setgid   |     | - User's $HOME   |
| - No secrets    |     | - Session store   |     | - User's perms   |
|                 |     | - Audit logging   |     |                  |
+-----------------+     +-------------------+     +------------------+
   Runs as:                 Runs as:                  Runs as:
   nobody / daemon          root                      authenticated user
```

### Security Boundaries

| Boundary | Threat | Mitigation |
|----------|--------|------------|
| Web -> Broker | Injection of malicious commands | Strict input validation, parameterized commands |
| Cookie theft | Session hijacking | HttpOnly, Secure, SameSite=Strict, short expiry |
| Broker compromise | Full system access | Minimal code surface, audit logging, seccomp |
| User process escape | Privilege escalation | Normal UNIX permissions, no setuid in spawned env |

## Patterns to Follow

### Pattern 1: Unix Socket for IPC

**What:** Use Unix domain socket for Hono-to-Broker communication.

**When:** Always for this architecture.

**Why:**
- More secure than TCP (filesystem permissions control access)
- No network exposure
- Can pass file descriptors (useful for PTY)

**Example:**

```typescript
// Broker side (listening)
import { createServer } from 'node:net';

const server = createServer((socket) => {
  socket.on('data', async (data) => {
    const message = JSON.parse(data.toString());
    const response = await handleMessage(message);
    socket.write(JSON.stringify(response));
  });
});

server.listen('/run/opencode/auth.sock');
// Set socket permissions: chmod 0660, chown root:opencode
```

```typescript
// Hono side (connecting)
import { createConnection } from 'node:net';

async function callBroker(message: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const socket = createConnection('/run/opencode/auth.sock');
    socket.write(JSON.stringify(message));
    socket.on('data', (data) => {
      resolve(JSON.parse(data.toString()));
      socket.end();
    });
    socket.on('error', reject);
  });
}
```

### Pattern 2: Cryptographically Random Session Tokens

**What:** Use crypto.randomBytes() for session IDs, not UUIDs.

**When:** Creating session tokens.

**Why:** UUIDs (especially v1/v4) can be predictable. Session tokens need high entropy.

**Example:**

```typescript
import { randomBytes } from 'node:crypto';

function generateSessionToken(): string {
  return randomBytes(32).toString('base64url'); // 256 bits of entropy
}
```

### Pattern 3: PAM Service File

**What:** Create dedicated PAM service file for opencode.

**When:** Setting up PAM authentication.

**Why:** Allows customization without modifying system auth.

**Example:**

```
# /etc/pam.d/opencode
auth       required     pam_unix.so
account    required     pam_unix.so
session    required     pam_unix.so
```

Or to use system defaults:

```
# /etc/pam.d/opencode
@include common-auth
@include common-account
@include common-session
```

### Pattern 4: Process Group for Cleanup

**What:** Spawn user processes in their own process group.

**When:** Spawning commands.

**Why:** Allows killing entire process tree on session end or abort.

**Example:**

```typescript
import { spawn } from 'node:child_process';

const child = spawn(command, args, {
  uid: userInfo.uid,
  gid: userInfo.gid,
  detached: true, // New process group
  // ...
});

// To kill entire tree:
process.kill(-child.pid, 'SIGTERM'); // Negative PID = process group
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Storing UID in Session Cookie

**What:** Including UID/username directly in the cookie value.

**Why bad:** Cookie can be tampered with. User could change UID to another user's.

**Instead:** Store only opaque session token in cookie. Broker maintains session->UID mapping server-side.

### Anti-Pattern 2: Hono Server Running as Root

**What:** Running the web-facing server with root privileges.

**Why bad:** Any vulnerability in web layer = full system compromise.

**Instead:** Web layer runs unprivileged. Only Auth Broker needs root, and it has minimal attack surface (only Unix socket, no HTTP parsing).

### Anti-Pattern 3: Long-Lived Sessions Without Refresh

**What:** Session tokens that are valid for days/weeks without activity check.

**Why bad:** Stolen cookie remains valid indefinitely.

**Instead:** Short base expiry (1 hour), extend on activity. "Remember me" = longer expiry but still requires refresh.

### Anti-Pattern 4: PAM Calls in Hot Path

**What:** Calling PAM on every request.

**Why bad:** PAM is slow (may consult LDAP, etc.). Performance disaster.

**Instead:** PAM only on login. Session validation is local lookup (memory or file).

### Anti-Pattern 5: Passing Shell Commands as Strings

**What:** `spawn('/bin/sh', ['-c', userInput])`

**Why bad:** Command injection if userInput contains shell metacharacters.

**Instead:** Pass command and args as array, let kernel handle execution. Never interpolate user input into shell strings.

## Build Order (Suggested Phases)

Based on dependencies and complexity:

### Phase 1: Session Middleware Foundation

**Build:**
- Session cookie middleware for Hono
- In-memory session store (stub for real broker)
- Session-aware API routes (require auth)
- Login/logout routes (stub with mock users)
- Session expiration logic

**Dependencies:** Existing Hono server
**Enables:** Testing auth flow end-to-end without PAM complexity

### Phase 2: Auth Broker Core

**Build:**
- Auth Broker daemon structure
- Unix socket IPC protocol
- PAM integration (native module or FFI)
- Session store (file-based)
- Basic spawn capability (setuid/setgid)

**Dependencies:** Phase 1 (to have endpoints calling broker)
**Enables:** Real authentication, but not yet command execution as user

**Critical decision:** How to interface with PAM from Node.js/Bun
- Option A: Native addon (node-pam, etc.)
- Option B: Shell out to `su` or helper binary
- Option C: Rust/C helper binary that broker spawns

### Phase 3: User Process Spawning

**Build:**
- Extend Pty.create() to accept UID/GID
- Broker-mediated PTY spawning
- Process I/O proxying through broker
- Process lifecycle management (kill on session end)
- Tool execution routing through broker

**Dependencies:** Phase 2 (broker exists, can spawn)
**Enables:** Commands actually run as authenticated user

### Phase 4: Login UI & Security Hardening

**Build:**
- Web login form (SolidJS)
- Insecure connection detection (HTTP without proxy)
- Warning/blocking for insecure login
- Audit logging
- Rate limiting on login attempts
- Session refresh on activity

**Dependencies:** Phase 3 (full flow works)
**Enables:** Production-ready security posture

### Phase 5: Multi-User Polish

**Build:**
- User-scoped data directories
- Session isolation verification
- Documentation (nginx/Caddy reverse proxy setup)
- Configuration in opencode.json
- Graceful degradation (auth disabled = current behavior)

**Dependencies:** Phase 4 (security in place)
**Enables:** Production deployment by users

## Integration with Existing Architecture

### Changes to Existing Components

| Component | Current | Changes Needed |
|-----------|---------|----------------|
| `Pty.create()` | Spawns as current user | Add UID/GID parameters, route through broker |
| `server/server.ts` | No auth middleware | Add session cookie middleware, login routes |
| `Instance` | Tied to current user's dirs | Support user-scoped paths based on session |
| `Storage` | Writes as current user | Ensure writes happen as authenticated user |
| `Bus` | Global events | May need user-scoped event streams |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Auth Broker | `packages/opencode/src/auth-broker/` | Privileged PAM/spawn daemon |
| Session Middleware | `packages/opencode/src/server/middleware/auth.ts` | Cookie validation |
| Login Routes | `packages/opencode/src/server/routes/auth.ts` | Login/logout endpoints |
| Login UI | `packages/app/src/routes/login.tsx` | Web login form |

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Overall architecture pattern | HIGH | Cockpit uses this exact model; well-established pattern |
| Component boundaries | HIGH | Standard privilege separation principles |
| PAM integration specifics | MEDIUM | Bun/Node PAM libraries need verification |
| Unix socket IPC | HIGH | Standard pattern, well-supported |
| Session cookie security | HIGH | Standard web security practices |
| Build order | MEDIUM | May need adjustment based on PAM library availability |

## Open Questions for Phase-Specific Research

1. **PAM library for Bun:** Does `node-pam` or similar work with Bun? May need Bun FFI or external binary.

2. **Process spawning with setuid:** Can Bun's native spawn handle UID/GID? Or need `bun-pty` modifications?

3. **macOS support:** PAM exists on macOS but behaves differently. What's the compatibility story?

4. **Session persistence:** What's the right store for sessions? File, SQLite, shared memory?

5. **Graceful degradation:** How does the system behave when broker is not running? Error? Single-user mode?

## Sources

- Cockpit architecture (training knowledge, confidence: MEDIUM - would benefit from official docs verification)
- PAM documentation (training knowledge, confidence: HIGH - stable, well-documented API)
- UNIX privilege separation patterns (training knowledge, confidence: HIGH - fundamental to UNIX security)
- Existing opencode codebase (analyzed via tool calls, confidence: HIGH)

---

*Architecture research: 2026-01-19*
