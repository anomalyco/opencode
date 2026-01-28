# Phase 5: User Process Execution - Context

**Gathered:** 2026-01-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Commands and file operations execute under the authenticated user's UNIX identity (UID/GID) instead of the server's identity. The broker spawns PTY sessions and handles file operations on behalf of authenticated users. This enables true multi-user access where each user's actions run with their own permissions.

</domain>

<decisions>
## Implementation Decisions

### Privilege Escalation Model

- Extend existing auth broker to spawn and manage user processes (broker already runs as root)
- Broker spawns PTY, returns file descriptor handle to web server which handles I/O
- All file operations proxied through broker for consistent privilege model
- Multiple concurrent sessions per user allowed
- Session ID passed in broker requests — broker validates and looks up user (web server doesn't pass raw uid)
- Process lifecycle configurable per-spawn: caller specifies whether process is tied to session
- Authentication alone is sufficient for execution rights (no separate authorization layer)
- Extend existing IPC protocol with new message types (spawn, kill, resize)

### Process Environment Setup

- Full login shell environment sourced (/etc/profile, ~/.profile, ~/.bashrc)
- Use user's login shell from /etc/passwd SHELL field
- Working directory: user's home directory ($HOME)
- Inherit SSH_AUTH_SOCK and GPG_AGENT_INFO if present (enables git push with keys)
- TERM environment variable configurable via client request
- Call initgroups() to get full supplementary group membership (wheel, docker, etc.)
- Respect user's configured umask from profile files
- Set OPENCODE=1 environment variable as marker

### PTY Ownership

- chown PTY device to authenticated user's uid/gid after allocation
- Record sessions in utmp/wtmp (sessions appear in `who` and `last`)
- Support window resize: propagate SIGWINCH from web client to PTY

### Failure Handling

- setuid failure: return error, process never starts (no fallback)
- Broker connection failure: 503 Service Unavailable
- Shell quick exit: return exit code and output to client
- File operation errors: detailed errors (permission denied, not found, etc.)

### Claude's Discretion

- Whether to set controlling terminal (setsid + TIOCSCTTY) for job control
- IPC protocol message format details
- PTY allocation mechanism (openpty, /dev/ptmx, etc.)
- File descriptor passing mechanism (Unix domain socket ancillary data)

</decisions>

<specifics>
## Specific Ideas

- Model after Cockpit's process execution — full user environment like SSH login
- Sessions should be visible in standard UNIX accounting (`who`, `last` commands)
- Agent socket inheritance important for git workflows with SSH keys

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 05-user-process-execution_
_Context gathered: 2026-01-22_
