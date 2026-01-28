# Phase 5: User Process Execution - Research

**Researched:** 2026-01-22
**Domain:** PTY allocation, user impersonation, file descriptor passing, session accounting
**Confidence:** MEDIUM (some areas require nightly Rust features or have platform-specific limitations)

## Summary

This phase extends the existing Rust auth broker to spawn PTY sessions as authenticated users and handle file operations. The research covered six key areas: PTY allocation in Rust, file descriptor passing over Unix sockets, user impersonation (setuid/setgid/initgroups), utmp/wtmp session recording, TypeScript/Bun fd handling, and file operations as user.

The recommended architecture uses the `nix` crate for PTY allocation via `openpty()` (not `forkpty()` due to async constraints) and user impersonation. For fd passing, either `tokio-seqpacket` or the `passfd` crate provides clean APIs. The broker spawns processes using `std::process::Command` with `CommandExt::uid()`, `gid()`, `groups()`, and `pre_exec()` for complete session setup. The existing IPC protocol extends naturally with new message types.

**Primary recommendation:** Allocate PTY in broker, chown to user, pass master fd to web server via SCM_RIGHTS, spawn shell in child process with proper user context using `pre_exec()` hook for session leader setup.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library    | Version | Purpose                                             | Why Standard                                       |
| ---------- | ------- | --------------------------------------------------- | -------------------------------------------------- |
| nix        | 0.29+   | PTY allocation, user impersonation, sendmsg/recvmsg | Already in Cargo.toml, comprehensive Unix bindings |
| tokio      | 1.x     | Async runtime                                       | Already used in broker                             |
| passfd     | 0.1.6   | Simple fd passing over Unix stream                  | Clean API, avoids nightly features                 |
| pam-client | latest  | PAM session management                              | Has open_session/close_session support             |
| libc       | 0.2+    | Low-level syscalls (pututxline)                     | Standard for FFI                                   |

### Supporting

| Library         | Version | Purpose                           | When to Use                           |
| --------------- | ------- | --------------------------------- | ------------------------------------- |
| pty-process     | 0.5.3   | High-level PTY spawn wrapper      | Alternative if nix is too low-level   |
| tokio-seqpacket | latest  | Seqpacket sockets with fd passing | If reliable message boundaries needed |
| utmp-rs         | latest  | Parsing utmp/wtmp (read-only)     | For testing/verification              |

### Alternatives Considered

| Instead of        | Could Use           | Tradeoff                                                       |
| ----------------- | ------------------- | -------------------------------------------------------------- |
| nix::pty::openpty | pty-process crate   | pty-process is higher-level but less control over chown timing |
| passfd            | nix sendmsg/recvmsg | passfd is simpler API, nix gives more control                  |
| pam-client        | nonstick            | nonstick doesn't have session management yet                   |

**Installation:**

```bash
# Add to Cargo.toml
cargo add pam-client passfd
# nix, tokio already present
```

## Architecture Patterns

### Recommended Process Flow

```
Web Server (TS)                    Broker (Rust, root)
     |                                    |
     |--[spawn_pty {session_id}]--------->|
     |                                    | 1. Validate session, lookup user
     |                                    | 2. openpty() -> master_fd, slave_fd
     |                                    | 3. chown(slave_fd, uid, gid)
     |                                    | 4. Fork child process
     |                                    |    - In child: setgroups, setgid, setuid
     |                                    |    - In child: setsid, TIOCSCTTY
     |                                    |    - In child: dup2 slave to 0,1,2
     |                                    |    - In child: exec login shell
     |                                    | 5. pam_open_session()
     |                                    | 6. Write utmp entry
     |<--[spawn_response {pty_id}]--------|
     |                                    |
     |--[get_fd {pty_id}]---------------->|
     |<--[fd via SCM_RIGHTS]--------------|  (master_fd passed)
     |                                    |
     | (I/O directly on master_fd)        |
     |                                    |
     |--[resize {pty_id, rows, cols}]---->|
     |                                    | ioctl(TIOCSWINSZ)
     |                                    |
     |--[kill {pty_id}]------------------>|
     |                                    | kill(pid, SIGTERM)
     |                                    | pam_close_session()
     |                                    | Update utmp entry
```

### Recommended Project Structure (Broker Extension)

```
packages/opencode-broker/src/
├── auth/              # Existing: PAM, rate limiting
├── ipc/               # Existing: protocol, server, handler
├── pty/               # NEW: PTY management
│   ├── mod.rs         # Module exports
│   ├── allocator.rs   # openpty, chown, fd passing
│   ├── session.rs     # Session state, lifecycle
│   └── spawn.rs       # Child process spawning
├── process/           # NEW: User process spawning
│   ├── mod.rs
│   ├── environment.rs # Login environment setup
│   └── impersonate.rs # setuid/setgid/initgroups
├── session/           # NEW: Session accounting
│   ├── mod.rs
│   └── utmp.rs        # utmp/wtmp recording
├── file/              # NEW: File operations
│   ├── mod.rs
│   └── proxy.rs       # read/write/list as user
└── main.rs            # Existing
```

### Pattern 1: PTY Allocation with nix

**What:** Allocate PTY pair, chown slave to user
**When to use:** Before spawning user process
**Example:**

```rust
// Source: https://docs.rs/nix/latest/nix/pty/fn.openpty.html
use nix::pty::{openpty, OpenptyResult};
use nix::unistd::{chown, Uid, Gid};
use std::os::fd::AsRawFd;

fn allocate_pty(uid: u32, gid: u32) -> Result<OpenptyResult, Error> {
    let OpenptyResult { master, slave } = openpty(None, None)?;

    // Get slave device path for chown
    let slave_name = nix::pty::ptsname_r(&master)?;

    // chown slave to authenticated user
    chown(slave_name.as_str(), Some(Uid::from_raw(uid)), Some(Gid::from_raw(gid)))?;

    Ok(OpenptyResult { master, slave })
}
```

### Pattern 2: User Impersonation with pre_exec

**What:** Drop privileges to authenticated user in child process
**When to use:** When spawning shell as user
**Example:**

```rust
// Source: https://doc.rust-lang.org/std/os/unix/process/trait.CommandExt.html
use std::process::Command;
use std::os::unix::process::CommandExt;
use nix::unistd::{initgroups, setgid, setuid, setsid, Gid, Uid};
use std::ffi::CString;

fn spawn_as_user(
    shell: &str,
    uid: u32,
    gid: u32,
    username: &str,
    home: &str,
    slave_fd: RawFd,
) -> Result<Child, Error> {
    let username_c = CString::new(username)?;

    unsafe {
        Command::new(shell)
            .arg("-l")  // Login shell
            .current_dir(home)
            .env_clear()
            .env("USER", username)
            .env("LOGNAME", username)
            .env("HOME", home)
            .env("SHELL", shell)
            .env("TERM", "xterm-256color")
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .env("OPENCODE", "1")
            .uid(uid)
            .gid(gid)
            .pre_exec(move || {
                // MUST call initgroups before setgid/setuid
                initgroups(&username_c, Gid::from_raw(gid))
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

                // Become session leader
                setsid().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;

                // Set controlling terminal
                // TIOCSCTTY = 0x540E on Linux, 0x20007461 on macOS
                #[cfg(target_os = "linux")]
                const TIOCSCTTY: libc::c_ulong = 0x540E;
                #[cfg(target_os = "macos")]
                const TIOCSCTTY: libc::c_ulong = 0x20007461;

                if libc::ioctl(slave_fd, TIOCSCTTY, 0) < 0 {
                    return Err(std::io::Error::last_os_error());
                }

                // Redirect stdio to slave
                libc::dup2(slave_fd, 0);
                libc::dup2(slave_fd, 1);
                libc::dup2(slave_fd, 2);

                // Close original slave fd if not 0,1,2
                if slave_fd > 2 {
                    libc::close(slave_fd);
                }

                Ok(())
            })
            .spawn()
    }
}
```

### Pattern 3: File Descriptor Passing with passfd

**What:** Send PTY master fd from broker to web server
**When to use:** After PTY allocated, before I/O begins
**Example:**

```rust
// Source: https://docs.rs/passfd/latest/passfd/
use passfd::FdPassingExt;
use std::os::unix::net::UnixStream;

// Sender (broker)
fn send_pty_fd(stream: &UnixStream, master_fd: RawFd) -> Result<(), Error> {
    stream.send_fd(master_fd)?;
    Ok(())
}

// Receiver (would be in TypeScript via native addon)
fn recv_pty_fd(stream: &UnixStream) -> Result<RawFd, Error> {
    let fd = stream.recv_fd()?;
    Ok(fd)
}
```

### Anti-Patterns to Avoid

- **Using forkpty in async context:** forkpty does fork+exec atomically which doesn't work with Tokio's async model. Use openpty + manual fork instead.
- **Calling setuid before setgid/initgroups:** Must call initgroups, then setgid, then setuid. Wrong order leaves supplementary groups incorrect.
- **Forgetting setsid:** Without setsid, the child won't be a session leader and TIOCSCTTY fails.
- **Not closing slave fd in parent:** After fork, parent must close slave fd; child must close master fd.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem                | Don't Build               | Use Instead                    | Why                                |
| ---------------------- | ------------------------- | ------------------------------ | ---------------------------------- |
| PTY allocation         | Custom /dev/ptmx handling | nix::pty::openpty              | Handles grantpt/unlockpt correctly |
| User credential switch | Manual setuid calls       | CommandExt::uid/gid + pre_exec | Gets supplementary groups right    |
| FD passing             | Raw sendmsg/recvmsg       | passfd crate                   | Handles SCM_RIGHTS correctly       |
| PAM session management | Direct PAM FFI            | pam-client crate               | Safe wrappers, auto-cleanup        |
| utmp/wtmp parsing      | Manual struct reading     | utmp-rs (read)                 | Cross-platform struct handling     |

**Key insight:** Unix process/session management has many subtle requirements (correct syscall order, platform differences, signal-safety in pre_exec). Libraries handle these edge cases.

## Common Pitfalls

### Pitfall 1: Wrong Order of Privilege Dropping

**What goes wrong:** Supplementary groups not set correctly, user can access files they shouldn't
**Why it happens:** Calling setuid before initgroups/setgroups
**How to avoid:** Always call in order: initgroups -> setgid -> setuid
**Warning signs:** User missing expected group memberships (can't access docker socket, etc.)

### Pitfall 2: Async-Signal-Safety in pre_exec

**What goes wrong:** Deadlock or undefined behavior in child after fork
**Why it happens:** Calling non-async-signal-safe functions (malloc, mutex, logging) in pre_exec
**How to avoid:** Only use async-signal-safe syscalls in pre_exec. No heap allocation, no locks.
**Warning signs:** Intermittent hangs, zombie processes

### Pitfall 3: File Descriptor Leaks

**What goes wrong:** FDs accumulate, hit ulimit, security issue (fd accessible to wrong process)
**Why it happens:** Not closing fds in parent after fork, not setting CLOEXEC
**How to avoid:**

- Close slave fd in parent immediately after fork
- Set CLOEXEC on master fd
- Use OwnedFd to auto-close on drop
  **Warning signs:** `lsof` shows many open fds, "too many open files" errors

### Pitfall 4: SIGCHLD Handling Conflicts

**What goes wrong:** Child process exit not detected, zombies accumulate
**Why it happens:** Tokio's signal handling conflicts with manual SIGCHLD handling
**How to avoid:** Use tokio::process::Child which integrates with Tokio's signal handling
**Warning signs:** `ps aux | grep defunct` shows zombie processes

### Pitfall 5: Platform-Specific TIOCSCTTY

**What goes wrong:** Controlling terminal not set on macOS
**Why it happens:** TIOCSCTTY constant differs between Linux (0x540E) and macOS (0x20007461)
**How to avoid:** Use cfg(target_os) for correct constant, or use nix crate's abstraction
**Warning signs:** Job control (Ctrl+C, Ctrl+Z) doesn't work in spawned shell

### Pitfall 6: Missing PATH in Environment

**What goes wrong:** Commands not found in spawned shell
**Why it happens:** env_clear() removes PATH, manual PATH doesn't include expected dirs
**How to avoid:** Source login profile or set sensible default PATH including /usr/local/bin:/usr/bin:/bin
**Warning signs:** "command not found" for basic commands

## Code Examples

Verified patterns from official sources:

### SCM_RIGHTS with nix crate

```rust
// Source: https://docs.rs/nix/latest/nix/sys/socket/enum.ControlMessage.html
use nix::sys::socket::{sendmsg, ControlMessage, MsgFlags};
use std::io::IoSlice;
use std::os::fd::RawFd;

fn send_fd_with_nix(socket_fd: RawFd, fd_to_send: RawFd) -> nix::Result<()> {
    let iov = [IoSlice::new(b"x")];  // Must send at least 1 byte
    let fds = [fd_to_send];
    let cmsg = [ControlMessage::ScmRights(&fds)];
    sendmsg::<()>(socket_fd, &iov, &cmsg, MsgFlags::empty(), None)?;
    Ok(())
}
```

### Receiving FD with nix crate

```rust
// Source: https://docs.rs/nix/latest/nix/sys/socket/fn.recvmsg.html
use nix::sys::socket::{recvmsg, ControlMessageOwned, MsgFlags};
use nix::cmsg_space;
use std::io::IoSliceMut;

fn recv_fd_with_nix(socket_fd: RawFd) -> nix::Result<RawFd> {
    let mut buf = [0u8; 1];
    let mut iov = [IoSliceMut::new(&mut buf)];
    let mut cmsg_buf = cmsg_space!([RawFd; 1]);

    let msg = recvmsg::<()>(socket_fd, &mut iov, Some(&mut cmsg_buf), MsgFlags::empty())?;

    for cmsg in msg.cmsgs()? {
        if let ControlMessageOwned::ScmRights(fds) = cmsg {
            if let Some(&fd) = fds.first() {
                return Ok(fd);
            }
        }
    }
    Err(nix::Error::EINVAL)
}
```

### Writing utmp entry with libc

```rust
// Source: https://docs.rs/libc/latest/libc/struct.utmpx.html
use libc::{utmpx, pututxline, setutxent, endutxent, USER_PROCESS, DEAD_PROCESS};
use std::ffi::CString;
use std::time::{SystemTime, UNIX_EPOCH};

unsafe fn write_utmp_login(
    username: &str,
    tty: &str,
    pid: i32,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut entry: utmpx = std::mem::zeroed();

    entry.ut_type = USER_PROCESS as i16;
    entry.ut_pid = pid;

    // Copy tty name (strip /dev/ prefix if present)
    let tty_short = tty.strip_prefix("/dev/").unwrap_or(tty);
    let tty_bytes = tty_short.as_bytes();
    entry.ut_line[..tty_bytes.len().min(31)]
        .copy_from_slice(&tty_bytes[..tty_bytes.len().min(31)].iter().map(|&b| b as i8).collect::<Vec<_>>());

    // Copy username
    let user_bytes = username.as_bytes();
    entry.ut_user[..user_bytes.len().min(31)]
        .copy_from_slice(&user_bytes[..user_bytes.len().min(31)].iter().map(|&b| b as i8).collect::<Vec<_>>());

    // Set timestamp
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?;
    entry.ut_tv.tv_sec = now.as_secs() as i64;
    entry.ut_tv.tv_usec = now.subsec_micros() as i64;

    setutxent();
    pututxline(&entry);
    endutxent();

    Ok(())
}
```

### Protocol Extension (IPC messages)

```rust
// Extend existing protocol.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Method {
    Authenticate,
    Ping,
    // New methods for Phase 5
    SpawnPty,
    KillPty,
    ResizePty,
    ReadFile,
    WriteFile,
    ListDir,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPtyParams {
    pub session_id: String,
    pub term: Option<String>,  // Default: xterm-256color
    pub cols: Option<u16>,     // Default: 80
    pub rows: Option<u16>,     // Default: 24
    pub env: Option<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPtyResponse {
    pub pty_id: String,
    pub pid: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePtyParams {
    pub pty_id: String,
    pub cols: u16,
    pub rows: u16,
}
```

## State of the Art

| Old Approach             | Current Approach        | When Changed                | Impact                                   |
| ------------------------ | ----------------------- | --------------------------- | ---------------------------------------- |
| forkpty() for async      | openpty() + manual fork | Always (async incompatible) | Use openpty in async contexts            |
| Rust std SocketAncillary | passfd/nix crates       | Ongoing (std unstable)      | Use external crates for SCM_RIGHTS       |
| bun-pty package          | Bun.Terminal built-in   | Bun v1.3.5 (Dec 2025)       | Can use native Bun.spawn terminal option |
| Manual PAM FFI           | pam-client crate        | 2024+                       | Safe session management                  |

**Deprecated/outdated:**

- `CommandExt::before_exec()`: Deprecated, use `pre_exec()` instead
- Rust std `unix_socket_ancillary_data`: Still nightly/unstable, use passfd or nix

## Open Questions

Things that couldn't be fully resolved:

1. **Bun fd receiving from Unix socket**
   - What we know: Node.js subprocess.send() can pass handles between Node processes
   - What's unclear: Can Bun receive raw fds from a non-Bun process (Rust broker)?
   - Recommendation: Test with passfd or use Node-compatible IPC, may need native addon

2. **macOS setgroups restriction**
   - What we know: nix crate notes setgroups not available on Apple platforms
   - What's unclear: How to handle supplementary groups on macOS (opendirectoryd?)
   - Recommendation: Use initgroups which works on macOS, verify behavior

3. **PAM session with nonstick**
   - What we know: Existing broker uses nonstick for auth, but session mgmt "coming soon"
   - What's unclear: Timeline for nonstick session support
   - Recommendation: Add pam-client for session mgmt, or use libc pam bindings directly

4. **utmp on macOS**
   - What we know: macOS uses different utmp/wtmp paths and format
   - What's unclear: Whether pututxline works correctly on macOS
   - Recommendation: Make utmp recording optional, test on both platforms

## Sources

### Primary (HIGH confidence)

- [nix crate pty module](https://docs.rs/nix/latest/nix/pty/index.html) - openpty, forkpty documentation
- [nix crate unistd module](https://docs.rs/nix/latest/nix/unistd/index.html) - setuid, setgid, initgroups
- [CommandExt trait](https://doc.rust-lang.org/std/os/unix/process/trait.CommandExt.html) - uid(), gid(), groups(), pre_exec()
- [nix sendmsg/recvmsg](https://docs.rs/nix/latest/nix/sys/socket/fn.sendmsg.html) - SCM_RIGHTS examples
- [passfd crate](https://docs.rs/passfd/latest/passfd/) - Simple fd passing API
- [Bun v1.3.5 release](https://bun.com/blog/bun-v1.3.5) - Built-in PTY support

### Secondary (MEDIUM confidence)

- [pty-process crate](https://docs.rs/pty-process/latest/pty_process/) - High-level PTY spawn wrapper
- [pam-client crate](https://docs.rs/pam-client/latest/pam_client/) - PAM session management
- [tokio-seqpacket](https://docs.rs/tokio-seqpacket/latest/tokio_seqpacket/) - Seqpacket with fd passing
- [Cockpit bridge guide](https://cockpit-project.org/guide/latest/cockpit-bridge.1) - Process execution model
- [utmp-rs](https://docs.rs/utmp-rs) - utmp parsing

### Tertiary (LOW confidence)

- WebSearch results on SSH session setup, login shell environment
- WebSearch results on Bun FFI file descriptor handling

## Metadata

**Confidence breakdown:**

- Standard stack: MEDIUM - nix crate well-documented, but fd passing to Bun needs validation
- Architecture: HIGH - Pattern follows established Cockpit/SSH models
- Pitfalls: HIGH - Well-documented Unix process management gotchas
- Code examples: MEDIUM - Adapted from docs, not tested in this specific context

**Research date:** 2026-01-22
**Valid until:** 2026-02-22 (Bun rapidly evolving, check for updates)
