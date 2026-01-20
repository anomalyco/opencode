# Domain Pitfalls: PAM/System Authentication for Web Applications

**Domain:** Web application with system authentication (Cockpit model)
**Researched:** 2026-01-19
**Overall Confidence:** MEDIUM (based on training data - WebSearch/WebFetch unavailable for verification)

---

## Critical Pitfalls

Mistakes that cause security breaches, privilege escalation, or require complete rewrites.

---

### Pitfall 1: Running Web Server as Root

**What goes wrong:** The web server runs as root to access PAM and spawn user processes. A single vulnerability (XSS, injection, path traversal) gives attackers root access to the entire system.

**Why it happens:**
- PAM authentication requires reading `/etc/shadow` (root-only by default)
- Spawning processes as arbitrary users requires `setuid`/`setgid` capabilities
- Developers take the "easy path" of running everything as root

**Consequences:**
- Any web vulnerability becomes a root compromise
- Session fixation or hijacking gives attacker root shell
- Memory corruption bugs become root exploits
- File read vulnerabilities expose `/etc/shadow`

**Prevention:**
1. **Privilege separation architecture:** Use a minimal setuid helper binary for PAM auth and process spawning
2. **Drop privileges immediately:** After binding to port, drop to unprivileged user
3. **Capability-based approach:** Use Linux capabilities (`CAP_SETUID`, `CAP_SETGID`) instead of full root
4. **Reference Cockpit's model:** They use `cockpit-ws` (unprivileged) + `cockpit-session` (setuid helper)

**Detection (warning signs):**
- Server process running as UID 0 in production
- No privilege separation in architecture docs
- PAM calls made directly from web request handler
- `spawn()` calls with `uid` option in main process

**Phase to address:** Architecture design (Phase 1) - must be foundational

**Confidence:** HIGH - this is well-documented security architecture principle

---

### Pitfall 2: PAM Conversation Function Misuse

**What goes wrong:** Incorrect implementation of the PAM conversation function leads to authentication bypass, memory corruption, or information disclosure.

**Why it happens:**
- PAM's conversation API is complex and callback-based
- Multiple message types exist (echo on/off, error, text info)
- Developers assume single username/password exchange
- Memory management for responses is non-trivial

**Consequences:**
- Authentication bypass if conversation returns wrong response
- Buffer overflow if response allocation is incorrect
- Credential exposure if echo-on messages handled like echo-off
- Hang/DoS if conversation blocks incorrectly

**Prevention:**
1. **Handle all PAM message types:**
   ```c
   switch (msg[i]->msg_style) {
     case PAM_PROMPT_ECHO_OFF:  // Password - never echo
     case PAM_PROMPT_ECHO_ON:   // Username - may echo
     case PAM_ERROR_MSG:        // Error message - log, don't send to client
     case PAM_TEXT_INFO:        // Info - log only
   }
   ```
2. **Use established PAM wrappers:** Don't write raw PAM conversation from scratch
3. **Memory discipline:** PAM expects `malloc`-allocated responses; caller frees
4. **Timeout conversations:** Don't block forever waiting for PAM module input

**Detection (warning signs):**
- Custom C code implementing `pam_conv` without handling all 4 message types
- No timeout on PAM authentication calls
- Response buffer allocated on stack instead of heap
- Assuming PAM only sends one prompt

**Phase to address:** Core authentication implementation (Phase 2)

**Confidence:** MEDIUM - based on PAM API documentation patterns from training

---

### Pitfall 3: Session Token Predictability / Weak Generation

**What goes wrong:** Session tokens can be predicted, brute-forced, or reused, allowing session hijacking.

**Why it happens:**
- Using weak random sources (Math.random, timestamp-based)
- Token too short for brute-force resistance
- Sequential or predictable token generation
- Reusing tokens across sessions

**Consequences:**
- Attacker hijacks active user session
- Attacker gains same privileges as victim user
- Shell access as victim's UNIX user
- Lateral movement to other systems via SSH keys, sudo, etc.

**Prevention:**
1. **Cryptographically secure random:** Use `crypto.randomBytes()` or equivalent
2. **Sufficient entropy:** Minimum 128 bits (32 hex chars) of randomness
3. **Token binding:** Consider binding to IP or user-agent (with trade-offs)
4. **One-time generation:** Never reuse tokens; generate fresh on each login
5. **Example:**
   ```typescript
   import { randomBytes } from 'crypto';
   const sessionToken = randomBytes(32).toString('hex'); // 256 bits
   ```

**Detection (warning signs):**
- `Math.random()` anywhere near token generation
- Tokens shorter than 32 characters
- Tokens containing timestamps or sequential components
- Same token appearing in multiple sessions

**Phase to address:** Session management implementation (Phase 2-3)

**Confidence:** HIGH - cryptographic best practice, well-documented

---

### Pitfall 4: Credentials in Logs, Errors, or Memory

**What goes wrong:** Passwords appear in application logs, error messages sent to client, stack traces, or persist in memory longer than necessary.

**Why it happens:**
- Logging request bodies for debugging
- Including full error context in responses
- Not clearing password buffers after use
- Crash dumps including memory state

**Consequences:**
- Log aggregation exposes all user passwords
- Error responses leak password to attackers
- Memory forensics recovers credentials
- Compliance violations (many regulations prohibit password logging)

**Prevention:**
1. **Never log credentials:** Redact password fields before logging
   ```typescript
   const safeLog = { ...request, password: '[REDACTED]' };
   log.info('login attempt', safeLog);
   ```
2. **Generic error messages:** "Invalid credentials" not "Password mismatch for user X"
3. **Clear memory:** Zero password buffers immediately after PAM call
4. **Audit log statements:** Review all `log.*` calls for credential exposure

**Detection (warning signs):**
- `JSON.stringify(request)` in log statements
- Error messages containing "password"
- No explicit credential redaction before logging
- Passwords stored in variables longer than needed

**Phase to address:** Authentication implementation (Phase 2), ongoing security review

**Confidence:** HIGH - fundamental security practice

---

### Pitfall 5: Transmitting Credentials Over HTTP (No TLS)

**What goes wrong:** Passwords sent over unencrypted connections, allowing network-level interception.

**Why it happens:**
- Development convenience (no cert setup)
- Assumption that network is trusted
- "TLS is handled by reverse proxy" without enforcement
- Localhost/LAN assumed to be safe

**Consequences:**
- Password interception on shared networks
- Corporate/ISP MITM captures credentials
- Credential stuffing attacks from passive monitoring
- Regulatory compliance failures

**Prevention:**
1. **Detect and warn/block insecure connections:**
   ```typescript
   // Check X-Forwarded-Proto or connection security
   if (!isSecureConnection(request) && !isLocalhost(request)) {
     return errorResponse('HTTPS required for authentication');
   }
   ```
2. **Document reverse proxy requirements clearly**
3. **Provide TLS setup guides for nginx/Caddy**
4. **Consider localhost exemption:** Local-only access may be acceptable

**Detection (warning signs):**
- No TLS check in authentication flow
- Login form submits to HTTP endpoint
- No documentation about TLS requirements
- Missing `Secure` flag on session cookies

**Phase to address:** Security middleware (Phase 2), Documentation (ongoing)

**Confidence:** HIGH - standard web security requirement

---

### Pitfall 6: Missing or Weak CSRF Protection

**What goes wrong:** Cross-site request forgery allows attackers to trigger actions using victim's authenticated session.

**Why it happens:**
- Assumption that same-origin policy protects
- Cookie-based auth without CSRF tokens
- Underestimating attack surface

**Consequences:**
- Attacker triggers commands as authenticated user
- Session creation/destruction attacks
- Configuration changes via CSRF
- Command execution if victim has shell access

**Prevention:**
1. **Use SameSite=Strict cookies:**
   ```typescript
   setCookie('session', token, {
     httpOnly: true,
     secure: true,
     sameSite: 'strict'
   });
   ```
2. **CSRF token for state-changing operations**
3. **Verify Origin/Referer headers**
4. **Separate session token from CSRF token**

**Detection (warning signs):**
- No `SameSite` attribute on session cookies
- State-changing operations via GET requests
- No CSRF token validation
- Cookie attributes not set explicitly

**Phase to address:** Session cookie implementation (Phase 2-3)

**Confidence:** HIGH - OWASP top 10 protection

---

### Pitfall 7: Command Injection via User Input in Spawned Processes

**What goes wrong:** User-controlled input reaches shell commands, allowing arbitrary command execution.

**Why it happens:**
- Constructing shell commands via string concatenation
- Not sanitizing environment variables
- Passing untrusted data to shell

**Consequences:**
- Remote code execution as the authenticated user
- Privilege escalation if user has sudo
- Data exfiltration
- System compromise

**Prevention:**
1. **Never shell out with user input in command string:**
   ```typescript
   // BAD
   exec(`ls ${userInput}`)

   // GOOD
   execFile('ls', [userInput])
   ```
2. **Use array-based spawn with explicit arguments**
3. **Sanitize environment variables passed to child processes**
4. **Existing opencode pattern:** Review `packages/opencode/src/tool/bash.ts` tree-sitter parsing

**Detection (warning signs):**
- Template strings in `exec()`/`spawn()` with user input
- `shell: true` with untrusted arguments
- Environment variables from request context

**Phase to address:** Process execution layer (Phase 3)

**Confidence:** HIGH - CWE-78 command injection is well-documented

---

### Pitfall 8: Insufficient Session Timeout / No Idle Timeout

**What goes wrong:** Sessions remain valid indefinitely, increasing hijacking window.

**Why it happens:**
- No explicit timeout logic
- "Remember me" without proper implementation
- Session cleanup not implemented
- Focus on features over security lifecycle

**Consequences:**
- Stolen session tokens usable for days/weeks
- Abandoned sessions on shared computers exploited
- Credential rotation ineffective

**Prevention:**
1. **Implement absolute timeout:** Maximum session lifetime (e.g., 24 hours)
2. **Implement idle timeout:** Session expires after inactivity (e.g., 30 minutes)
3. **Sliding expiration:** Activity extends session, but not beyond absolute
4. **"Remember me" as separate token:** Longer-lived, but requires re-authentication for sensitive actions

**Detection (warning signs):**
- Session tokens with no expiration timestamp
- No timestamp validation on session use
- No session cleanup job
- "Remember me" uses same session mechanism

**Phase to address:** Session management (Phase 2-3)

**Confidence:** HIGH - session management best practice

---

## Moderate Pitfalls

Mistakes that cause operational issues, user frustration, or security weaknesses (not immediate compromise).

---

### Pitfall 9: PAM Configuration Conflicts / Wrong Service Name

**What goes wrong:** PAM authentication fails silently or accepts wrong credentials due to misconfigured PAM service file.

**Why it happens:**
- Using generic "login" service without understanding implications
- Not creating application-specific PAM service file
- PAM module order incorrect
- System PAM configuration overwrites application settings

**Prevention:**
1. **Create application-specific PAM service:** `/etc/pam.d/opencode-web`
2. **Include appropriate modules for your use case**
3. **Test PAM configuration on target distributions**
4. **Document PAM requirements for users**

**Detection (warning signs):**
- Using hardcoded "login" or "system-auth" service name
- No documentation about PAM service file requirements
- Authentication works on dev machine but fails in production

**Phase to address:** PAM integration (Phase 2), Documentation (ongoing)

**Confidence:** MEDIUM - distribution-specific variations exist

---

### Pitfall 10: Race Conditions in Session Management

**What goes wrong:** Concurrent requests create race conditions in session creation, validation, or destruction.

**Why it happens:**
- Session state accessed without synchronization
- Multiple authentication attempts racing
- Session file/database writes not atomic

**Consequences:**
- Duplicate sessions created
- Session state corruption
- Token reuse after logout

**Prevention:**
1. **Atomic session operations:** Use database transactions or file locks
2. **Session ID as idempotency key:** Prevent duplicate creation
3. **Test concurrent access patterns**

**Detection (warning signs):**
- Session storage uses file system without locking
- Multiple login requests accepted in parallel
- No atomicity guarantees in session CRUD

**Phase to address:** Session storage implementation (Phase 2-3)

**Confidence:** MEDIUM - depends on concurrency patterns

---

### Pitfall 11: Inadequate Brute Force Protection

**What goes wrong:** Attackers can attempt unlimited password guesses.

**Why it happens:**
- No rate limiting on login endpoint
- No account lockout mechanism
- Rate limiting on wrong layer (easily bypassed)

**Consequences:**
- Weak passwords compromised via brute force
- Dictionary attacks succeed
- Credential stuffing possible

**Prevention:**
1. **Rate limit by IP:** Delay/block after N failures from same IP
2. **Rate limit by username:** Delay/block after N failures for same user
3. **Exponential backoff:** Increasing delays for repeated failures
4. **PAM can help:** `pam_faildelay`, `pam_tally2`/`pam_faillock` modules

**Detection (warning signs):**
- No rate limiting middleware on auth endpoints
- PAM configuration without delay/lockout modules
- No failed attempt logging

**Phase to address:** Authentication security (Phase 2-3)

**Confidence:** HIGH - standard auth protection

---

### Pitfall 12: User Enumeration via Timing or Error Messages

**What goes wrong:** Attackers can determine valid usernames by analyzing response times or error messages.

**Why it happens:**
- Different code paths for valid/invalid users
- Error messages like "User not found" vs "Invalid password"
- PAM returns faster for non-existent users

**Consequences:**
- Attacker builds list of valid usernames
- Targeted attacks on known accounts
- Social engineering enabled

**Prevention:**
1. **Constant-time comparison:** Always complete full auth flow
2. **Generic error messages:** Same message for all failure types
3. **Artificial delay:** Normalize response times
   ```typescript
   const startTime = Date.now();
   const result = await authenticate(user, pass);
   const elapsed = Date.now() - startTime;
   await sleep(Math.max(0, MIN_AUTH_TIME - elapsed)); // Normalize timing
   return result;
   ```

**Detection (warning signs):**
- Error messages distinguishing username vs password failure
- No timing normalization
- Early return for unknown users

**Phase to address:** Authentication implementation (Phase 2)

**Confidence:** HIGH - OWASP authentication guidance

---

### Pitfall 13: Privilege Escalation via Sudo/Polkit Bypass

**What goes wrong:** Authenticated user gains more privileges than intended through sudo misconfiguration or polkit policy gaps.

**Why it happens:**
- Assuming system's sudo/polkit is correctly configured
- Not documenting privilege requirements
- Application spawns shells that inherit unexpected sudo rights

**Consequences:**
- Normal user executes commands as root
- Unintended privilege escalation paths
- Breaks principle of least privilege

**Prevention:**
1. **Document required privileges:** Clear statement of what users can do
2. **Don't modify sudo/polkit:** Let sysadmin control policies
3. **Consider restricted shell option:** For limited use cases
4. **Audit spawned process capabilities**

**Detection (warning signs):**
- Application modifies sudo configuration
- No documentation about privilege model
- Assumes all users should have same access

**Phase to address:** Security model documentation (Phase 1), Process execution (Phase 3)

**Confidence:** MEDIUM - deployment-specific

---

### Pitfall 14: Cookie Security Attributes Missing

**What goes wrong:** Session cookies lack security attributes, enabling various attacks.

**Why it happens:**
- Default cookie settings used
- Security attributes not understood
- Framework defaults not reviewed

**Consequences:**
- `HttpOnly` missing: XSS can steal session
- `Secure` missing: Cookie sent over HTTP
- `SameSite` missing: CSRF possible
- `Path` too broad: Cookie sent to unintended endpoints

**Prevention:**
```typescript
setCookie('session', token, {
  httpOnly: true,      // Prevent JavaScript access
  secure: true,        // HTTPS only (except localhost dev)
  sameSite: 'strict',  // Prevent CSRF
  path: '/',           // Or more restrictive
  maxAge: 86400,       // 24 hours (or appropriate)
});
```

**Detection (warning signs):**
- Cookie set without explicit options object
- No `HttpOnly` in cookie attributes
- `SameSite=None` without `Secure`

**Phase to address:** Session implementation (Phase 2-3)

**Confidence:** HIGH - well-documented cookie security

---

## Minor Pitfalls

Annoyances and technical debt that are fixable without major rework.

---

### Pitfall 15: Inconsistent Error Handling Between PAM and Application

**What goes wrong:** PAM error codes not properly mapped to user-facing errors, causing confusing messages or information leaks.

**Prevention:**
- Map PAM return codes to appropriate HTTP status codes
- Log detailed PAM errors internally, show generic message to user
- Handle all PAM return codes, not just success/fail

**Phase to address:** Error handling (Phase 2)

**Confidence:** MEDIUM

---

### Pitfall 16: Session Storage Location Security

**What goes wrong:** Session files stored in world-readable location or without proper permissions.

**Prevention:**
- Store sessions in `/var/lib/opencode/sessions/` or user-specific directory
- Set permissions `0600` on session files
- Clean up expired sessions regularly

**Phase to address:** Session storage (Phase 2-3)

**Confidence:** HIGH

---

### Pitfall 17: Missing Login Audit Trail

**What goes wrong:** No logging of authentication events for security auditing.

**Prevention:**
- Log all login attempts (success and failure)
- Include timestamp, username, source IP
- Integrate with system auth logs (syslog)
- Don't log passwords

**Phase to address:** Logging infrastructure (Phase 2)

**Confidence:** HIGH

---

### Pitfall 18: Hardcoded Timeouts and Limits

**What goes wrong:** Security parameters hardcoded, preventing operational adjustment.

**Prevention:**
- Make session timeout configurable in `opencode.json`
- Allow rate limiting thresholds to be configured
- Document all security-relevant configuration options

**Phase to address:** Configuration (Phase 2-3)

**Confidence:** MEDIUM

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Architecture design | Running as root | Design privilege separation from start |
| PAM integration | Conversation function bugs | Use established wrapper, test all message types |
| Session management | Weak tokens, no timeout | CSPRNG, explicit expiration, sliding window |
| Cookie handling | Missing security attributes | Explicit httpOnly, secure, sameSite |
| Process spawning | Command injection | Array-based spawn, never shell=true with user input |
| Error handling | Information disclosure | Generic messages, separate logging |
| Rate limiting | No brute force protection | IP + username rate limiting |
| Documentation | Unclear TLS requirements | Explicit reverse proxy setup guide |

---

## Cockpit Reference Architecture

Since this project follows the Cockpit model, key patterns to replicate:

1. **cockpit-ws (web server):** Runs unprivileged, handles HTTP/WebSocket
2. **cockpit-session (setuid helper):** Spawned for each login, authenticates via PAM, spawns user shell
3. **cockpit-bridge:** Runs as authenticated user, executes commands
4. **Session cookies:** Secure, HttpOnly, tied to specific session subprocess

**Key insight:** The web-facing component never directly calls PAM or spawns user processes. All privileged operations go through a minimal setuid helper.

---

## Sources and Confidence Notes

- **PAM API documentation:** Based on training data (Linux-PAM guides), MEDIUM confidence
- **Cockpit architecture:** Based on training data about Cockpit design, MEDIUM confidence
- **Cookie security:** Well-documented web security standards, HIGH confidence
- **Session management:** OWASP guidelines, HIGH confidence
- **Command injection:** CWE-78, well-documented, HIGH confidence
- **Privilege separation:** Standard Unix security architecture, HIGH confidence

**Limitation:** WebSearch and WebFetch were unavailable. Claims about specific PAM APIs and Cockpit implementation should be verified against current official documentation before implementation.

---

*Pitfalls research: 2026-01-19*
