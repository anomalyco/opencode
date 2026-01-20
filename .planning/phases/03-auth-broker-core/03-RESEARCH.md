# Phase 3: Auth Broker Core - Research

**Researched:** 2026-01-20
**Domain:** Privileged PAM authentication broker daemon in Rust
**Confidence:** MEDIUM-HIGH

## Summary

Phase 3 implements a privileged authentication broker daemon in Rust that handles PAM authentication via Unix socket IPC. The broker runs as root and validates credentials for the unprivileged opencode web server, following the Cockpit authentication model.

Research validates that:
1. **Rust PAM crates exist and work** - `pam-client` is the recommended choice for cross-platform support (Linux-PAM and OpenPAM/macOS)
2. **PAM threading model is well-defined** - Each thread needs its own PAM handle; no shared handles
3. **macOS uses OpenPAM** - Same PAM API as Linux, with `pam_opendirectory` module for authentication
4. **Daemon pattern is standard** - systemd on Linux, launchd on macOS, no double-forking needed

**Primary recommendation:** Use `pam-client` crate for PAM integration, Tokio for async runtime, `tokio-util::codec::LinesCodec` for newline-delimited JSON over Unix socket, and `governor` for per-username rate limiting.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tokio | 1.x | Async runtime | De facto standard for async Rust |
| pam-client | 0.5.x | PAM authentication | Cross-platform (Linux, macOS), well-documented API |
| serde/serde_json | 1.x | JSON serialization | Universal Rust serialization |
| tokio-util | 0.7.x | Framed codec for IPC | Official Tokio utility for framed streams |
| governor | latest | Rate limiting | GCRA-based, supports keyed (per-username) limiting |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tracing | 0.1.x | Structured logging | All logging throughout the daemon |
| tracing-subscriber | 0.3.x | Log output formatting | Syslog and stdout output |
| syslog | 7.x | Syslog integration | Production logging |
| thiserror | 1.x | Error types | Library-style error definitions |
| nix | 0.29.x | POSIX APIs | setuid/setgid, signal handling |
| sd-notify | 0.4.x | systemd integration | Signal readiness to systemd |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pam-client | pam (1wilkens) | pam-client has better macOS/OpenPAM support |
| pam-client | nonstick | nonstick is newer (0.1.1), less mature but claims broad platform support |
| LinesCodec | tokio-serde | LinesCodec simpler for newline-delimited JSON |
| governor | Custom HashMap | governor handles cleanup, jitter, proven algorithm |

**Installation:**
```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
pam-client = "0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio-util = { version = "0.7", features = ["codec"] }
governor = "0.6"
tracing = "0.1"
tracing-subscriber = "0.3"
thiserror = "1"
nix = { version = "0.29", features = ["process", "signal", "user"] }
sd-notify = "0.4"

# Platform-specific
[target.'cfg(target_os = "linux")'.dependencies]
syslog = "7"
```

## Architecture Patterns

### Recommended Project Structure
```
packages/opencode-broker/
├── Cargo.toml
├── src/
│   ├── main.rs           # Entry point, daemon setup
│   ├── lib.rs            # Library exports for testing
│   ├── config.rs         # Configuration loading
│   ├── ipc/
│   │   ├── mod.rs
│   │   ├── protocol.rs   # JSON message types
│   │   ├── server.rs     # Unix socket server
│   │   └── handler.rs    # Request handling
│   ├── auth/
│   │   ├── mod.rs
│   │   ├── pam.rs        # PAM wrapper
│   │   └── rate_limit.rs # Per-username rate limiting
│   └── platform/
│       ├── mod.rs        # Platform detection
│       ├── linux.rs      # Linux-specific (systemd)
│       └── macos.rs      # macOS-specific (launchd)
└── tests/
    └── integration.rs    # Mock PAM tests
```

### Pattern 1: Thread-per-Request PAM Model
**What:** Spawn a dedicated thread for each PAM authentication request
**When to use:** Always for PAM calls
**Why:** PAM handles are NOT thread-safe when shared; each thread needs its own handle

```rust
// Source: Linux-PAM documentation, GitHub issues
use std::thread;
use tokio::sync::oneshot;

async fn authenticate(username: String, password: String) -> Result<bool, AuthError> {
    let (tx, rx) = oneshot::channel();

    // PAM calls happen on a dedicated thread
    thread::spawn(move || {
        let result = do_pam_auth(&username, &password);
        let _ = tx.send(result);
    });

    rx.await.map_err(|_| AuthError::Internal)?
}

fn do_pam_auth(username: &str, password: &str) -> Result<bool, AuthError> {
    // Each thread creates its own PAM context
    use pam_client::{Context, Flag};
    use pam_client::conv_mock::Conversation;

    let mut context = Context::new(
        "opencode",
        Some(username),
        Conversation::with_credentials(username, password),
    )?;

    context.authenticate(Flag::NONE)?;
    context.acct_mgmt(Flag::NONE)?;

    Ok(true)
}
```

### Pattern 2: Newline-Delimited JSON Protocol
**What:** JSON messages separated by newlines over Unix socket
**When to use:** All IPC communication
**Why:** Simple, debuggable, multiplexing via request IDs

```rust
// Source: tokio-util documentation
use tokio_util::codec::{FramedRead, FramedWrite, LinesCodec};
use tokio::net::UnixStream;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Request {
    id: String,          // For multiplexing responses
    version: u32,        // Protocol version
    method: String,      // "authenticate" | "ping"
    #[serde(flatten)]
    params: RequestParams,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum RequestParams {
    Authenticate { username: String, password: String },
    Ping {},
}

#[derive(Serialize, Deserialize)]
struct Response {
    id: String,
    success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

async fn handle_connection(stream: UnixStream) {
    let (reader, writer) = stream.into_split();
    let mut lines = FramedRead::new(reader, LinesCodec::new_with_max_length(64 * 1024));
    let mut output = FramedWrite::new(writer, LinesCodec::new());

    while let Some(line) = lines.next().await {
        let request: Request = serde_json::from_str(&line?)?;
        let response = handle_request(request).await;
        output.send(serde_json::to_string(&response)?).await?;
    }
}
```

### Pattern 3: Keyed Rate Limiting
**What:** Per-username rate limiting for failed authentication attempts
**When to use:** Before PAM authentication
**Why:** Prevents brute-force attacks against specific accounts

```rust
// Source: governor documentation
use governor::{Quota, RateLimiter, state::keyed::DefaultKeyedStateStore};
use std::num::NonZeroU32;
use std::sync::Arc;

type UsernameRateLimiter = RateLimiter<String, DefaultKeyedStateStore<String>, governor::clock::DefaultClock>;

fn create_rate_limiter() -> Arc<UsernameRateLimiter> {
    // 5 failed attempts per minute per username
    let quota = Quota::per_minute(NonZeroU32::new(5).unwrap());
    Arc::new(RateLimiter::keyed(quota))
}

async fn check_rate_limit(limiter: &UsernameRateLimiter, username: &str) -> Result<(), AuthError> {
    match limiter.check_key(&username.to_string()) {
        Ok(_) => Ok(()),
        Err(_) => Err(AuthError::RateLimited),
    }
}
```

### Anti-Patterns to Avoid
- **Shared PAM handle across threads:** Each thread MUST create its own PAM context
- **Logging passwords:** NEVER log credentials, even in debug mode
- **Detailed error messages:** Return generic "authentication failed" to prevent user enumeration
- **Unbounded LinesCodec:** Always set max_length to prevent DoS
- **Root without justification:** Document clearly why root is needed (PAM requires reading /etc/shadow)

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PAM integration | Custom FFI | pam-client crate | Thread safety, error handling, platform differences |
| Rate limiting | HashMap + timestamp | governor crate | Cleanup, fairness, proven GCRA algorithm |
| Protocol framing | Manual buffering | tokio-util LinesCodec | Edge cases, backpressure, max length |
| Syslog formatting | printf-style | tracing + syslog crate | Structured logging, proper facility codes |
| Username validation | Simple regex | Strict allowlist | Security-critical, POSIX rules complex |

**Key insight:** Authentication and IPC code is security-critical. Use battle-tested libraries, not custom implementations.

## Common Pitfalls

### Pitfall 1: PAM Thread Safety Violations
**What goes wrong:** Crash or undefined behavior when sharing PAM handle across threads
**Why it happens:** PAM documentation states handles are NOT thread-safe when shared
**How to avoid:** Create fresh PAM context for each authentication request in its own thread
**Warning signs:** Segfaults, "double free" errors, corrupted authentication state

### Pitfall 2: Password Exposure in Logs
**What goes wrong:** Passwords appear in logs, debug output, or error messages
**Why it happens:** Default serialization includes all struct fields
**How to avoid:**
- Use `#[serde(skip_serializing)]` on password fields
- Implement custom Debug that redacts passwords
- Never use `{:?}` on request structs containing passwords
**Warning signs:** Passwords in journalctl, syslog, or stdout

### Pitfall 3: User Enumeration via Error Messages
**What goes wrong:** Different errors for "user not found" vs "wrong password"
**Why it happens:** Natural to return detailed errors for debugging
**How to avoid:** Always return generic "authentication failed" externally; log details internally with tracing
**Warning signs:** Client can distinguish between invalid username and invalid password

### Pitfall 4: Socket Path Length Limits
**What goes wrong:** Socket creation fails on some platforms
**Why it happens:** macOS limits sun_path to 104 bytes; Linux to 108 bytes
**How to avoid:** Use short paths like `/run/opencode/auth.sock`
**Warning signs:** "Address too long" errors on macOS

### Pitfall 5: Stale Socket Files
**What goes wrong:** Daemon fails to start because socket file already exists
**Why it happens:** Previous unclean shutdown left socket file
**How to avoid:** Unlink socket path before bind(), clean up on exit/signal
**Warning signs:** "Address already in use" on daemon restart

### Pitfall 6: Fork/Exec in Async Context
**What goes wrong:** Deadlocks or undefined behavior when forking in async runtime
**Why it happens:** Tokio runtime state doesn't survive fork()
**How to avoid:** Use `std::thread::spawn` for PAM auth, never fork from async context
**Warning signs:** Hangs, zombie processes, mutex deadlocks

## Code Examples

Verified patterns from official sources:

### Unix Socket Server Setup
```rust
// Source: tokio documentation
use tokio::net::UnixListener;
use std::fs;

async fn run_server(socket_path: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Remove stale socket file
    let _ = fs::remove_file(socket_path);

    let listener = UnixListener::bind(socket_path)?;

    // Set permissions: owner read/write only
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600))?;
    }

    loop {
        let (stream, _addr) = listener.accept().await?;
        tokio::spawn(handle_connection(stream));
    }
}
```

### PAM Authentication with pam-client
```rust
// Source: pam-client documentation
use pam_client::{Context, Flag};
use pam_client::conv_mock::Conversation;

fn authenticate_user(service: &str, username: &str, password: &str) -> Result<(), pam_client::ErrorCode> {
    let conv = Conversation::with_credentials(username, password);
    let mut context = Context::new(service, Some(username), conv)?;

    // Authenticate
    context.authenticate(Flag::NONE)?;

    // Check account validity (expired, locked, etc.)
    context.acct_mgmt(Flag::NONE)?;

    Ok(())
}
```

### systemd Notify Integration
```rust
// Source: sd-notify crate
use sd_notify::NotifyState;

fn main() {
    // ... daemon initialization ...

    // Signal readiness to systemd
    let _ = sd_notify::notify(true, &[NotifyState::Ready]);

    // ... run daemon ...
}
```

### Username Validation
```rust
// Source: systemd.io/USER_NAMES, POSIX standards
fn validate_username(username: &str) -> Result<(), ValidationError> {
    // Length: 1-32 characters (practical limit for utmp compatibility)
    if username.is_empty() || username.len() > 32 {
        return Err(ValidationError::InvalidLength);
    }

    // Must start with lowercase letter or underscore
    let first = username.chars().next().unwrap();
    if !first.is_ascii_lowercase() && first != '_' {
        return Err(ValidationError::InvalidFirstChar);
    }

    // Allowed: lowercase letters, digits, underscore, hyphen
    // No uppercase, no spaces, no special characters
    for c in username.chars() {
        if !c.is_ascii_lowercase() && !c.is_ascii_digit() && c != '_' && c != '-' {
            return Err(ValidationError::InvalidChar(c));
        }
    }

    // No all-numeric usernames (confusion with UID)
    if username.chars().all(|c| c.is_ascii_digit()) {
        return Err(ValidationError::AllNumeric);
    }

    Ok(())
}
```

## Platform-Specific Details

### Linux
- **PAM config:** `/etc/pam.d/opencode`
- **Socket path:** `/run/opencode/auth.sock`
- **Service manager:** systemd
- **Logging:** journald via sd-journal or syslog

**systemd service file:**
```ini
# /etc/systemd/system/opencode-broker.service
[Unit]
Description=OpenCode Authentication Broker
After=network.target

[Service]
Type=notify
ExecStart=/usr/local/bin/opencode-broker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### macOS
- **PAM implementation:** OpenPAM
- **PAM module:** `pam_opendirectory.so` (authenticates via Open Directory)
- **PAM config:** `/etc/pam.d/opencode` (same format as Linux)
- **Socket path:** `/var/run/opencode/auth.sock` or `~/Library/Application Support/opencode/auth.sock`
- **Service manager:** launchd

**launchd plist:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.opencode.broker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/opencode-broker</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

**macOS PAM service file:**
```
# /etc/pam.d/opencode
auth       required       pam_opendirectory.so
account    required       pam_opendirectory.so
```

## NPM Integration for Rust Binary

### Approach: Source Compilation at Install Time

Based on the CONTEXT.md decision to "compile from source, integrated into npm install process":

**Option 1: postinstall script with cargo**
```json
{
  "name": "opencode",
  "scripts": {
    "postinstall": "node scripts/build-broker.js"
  }
}
```

```javascript
// scripts/build-broker.js
const { execSync } = require('child_process');
const path = require('path');

const brokerDir = path.join(__dirname, '../packages/opencode-broker');

try {
  execSync('cargo build --release', {
    cwd: brokerDir,
    stdio: 'inherit'
  });
  console.log('opencode-broker built successfully');
} catch (error) {
  console.error('Failed to build opencode-broker. Is Rust installed?');
  console.error('Install Rust: https://rustup.rs/');
  process.exit(1);
}
```

**Tradeoffs:**
- PRO: Always native, no cross-compilation needed
- PRO: Works on any platform with Rust toolchain
- CON: Requires Rust installed on user's machine
- CON: Longer install time (compile from source)

**Recommendation:** For Phase 3, use source compilation. Pre-built binaries can be added later as an optimization.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Double-fork daemon | systemd Type=notify | systemd adoption | No daemonization code needed |
| /var/run sockets | /run sockets | FHS 3.0 | /var/run is now symlink to /run |
| pam crate | pam-client crate | 2022 | Better cross-platform, safer API |
| Manual thread pools | Tokio spawn_blocking | Tokio 1.0 | Simpler async/sync bridge |

**Deprecated/outdated:**
- **Double-fork daemonization:** systemd handles this; explicit daemonization breaks Type=notify
- **tokio-uds crate:** Merged into tokio::net, no longer separate crate
- **pam-sys direct usage:** Use pam-client wrapper for safety

## Open Questions

Things that couldn't be fully resolved:

1. **pam-client macOS testing status**
   - What we know: Documentation claims OpenPAM support, tested on NetBSD
   - What's unclear: Real-world macOS testing, Apple Silicon compatibility
   - Recommendation: Test early in development; nonstick is backup option

2. **Rate limiting persistence across restarts**
   - What we know: governor uses in-memory state
   - What's unclear: Whether rate limits should survive daemon restart
   - Recommendation: Start with in-memory (lost on restart); add persistence if needed

3. **Socket permission model for multi-user**
   - What we know: CONTEXT.md says "any local user can connect"
   - What's unclear: How to allow any user while preventing network access
   - Recommendation: Mode 0666 in dedicated directory, rely on PAM for actual auth

## Sources

### Primary (HIGH confidence)
- [tokio documentation](https://docs.rs/tokio/latest/tokio/) - Unix socket, async runtime
- [tokio-util codec](https://docs.rs/tokio-util/latest/tokio_util/codec/index.html) - LinesCodec, Framed
- [pam-client documentation](https://docs.rs/pam-client/latest/pam_client/) - PAM API, platform support
- [governor documentation](https://docs.rs/governor/latest/governor/) - Rate limiting API
- [systemd.io/USER_NAMES](https://systemd.io/USER_NAMES/) - Username validation rules
- [launchd.info](https://launchd.info/) - launchd plist configuration
- [Cockpit authentication](https://cockpit-project.org/guide/latest/authentication) - Reference architecture

### Secondary (MEDIUM confidence)
- [Linux-PAM GitHub issues](https://github.com/linux-pam/linux-pam/issues/109) - Thread safety clarification
- [OpenPAM Wikipedia](https://en.wikipedia.org/wiki/OpenPAM) - macOS PAM implementation
- [Red Hat username rules](https://access.redhat.com/solutions/30164) - Username validation
- [Unix socket permissions](https://linuxvox.com/blog/unix-socket-permissions-linux/) - Socket security

### Tertiary (LOW confidence)
- [nonstick crate](https://lib.rs/crates/nonstick) - Alternative PAM library, new (0.1.1)
- [rust-to-npm](https://github.com/a11ywatch/rust-to-npm) - npm packaging (needs validation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Tokio, serde, pam-client are well-established
- Architecture: HIGH - Cockpit model is proven, patterns well-documented
- PAM threading: HIGH - Official documentation confirms per-thread handles
- macOS support: MEDIUM - OpenPAM documented but practical testing needed
- npm integration: MEDIUM - Approach is standard but details may need adjustment

**Research date:** 2026-01-20
**Valid until:** 2026-02-20 (30 days - stable domain)

---

*Phase: 03-auth-broker-core*
*Research complete: 2026-01-20*
