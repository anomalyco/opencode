# opencode-pty

Moved from [anomalyco/opencode-pty](https://github.com/anomalyco/opencode-pty)
(at 443945a, v0.3.1). It lives in the OpenCode monorepo at
`packages/process-daemon`; run the commands below from that directory.

Experimental threaded PTY service core for OpenCode.

It uses `portable-pty` to own terminal child processes and `libghostty-vt` to
maintain authoritative terminal state and answer terminal protocol queries.
Every terminal has isolated blocking I/O and actor threads, so one terminal
cannot block the service or another terminal.

Every daemon has one owner connection. The playground starts a daemon and holds
that connection until exit; exiting the playground stops the daemon and all its
terminals. Observer commands connect to an existing daemon without taking ownership.
The service uses a private authenticated local byte stream (Unix socket or Windows
named pipe) and an atomic registration file.

Integrations launch `opencode-pty daemon --name NAME [--runtime-dir DIR]` (protocol 7).
The server must claim the daemon within 5 seconds by sending the authenticated
framed envelope `{"token":"...","request":{"op":"own","instance_id":"..."}}`.
The response is `{"type":"owned"}`; that connection stays open as the sole
owner. Ordinary requests and subscriptions use separate connections.
The instance ID and token come from the private registration file.

Losing the owner connection stops the daemon and its terminals unless the owner
first sends `{"token":"...","request":{"op":"prepare_handoff"}}` on that same
connection. The response is `{"type":"handoff","ticket":"...","expires_at":123}`,
where `expires_at` is Unix milliseconds, 120 seconds from preparation. Repeated
preparation during that window returns the same ticket and deadline. A successor
claims the same instance with the ticket in its `own` request, even while the old
owner is still connected. Successful adoption consumes the ticket atomically;
only one successor can claim it. The superseded connection can no longer prepare
handoffs or shut down the daemon, and its disconnect does not affect the new owner.
Expiry stops an unowned daemon; if the old owner is still connected, expiry simply
cancels the handoff. An ordinary authenticated `shutdown` request, or one from the
current owner, stops the daemon even during handoff. No ownership or handoff state
is persisted.

Every command requires `--name NAME`, which selects the runtime directory
`DIR/NAME`. `--runtime-dir DIR` is optional and defaults to OpenCode's state
directory, `${XDG_STATE_HOME:-~/.local/state}/opencode/pty`. Names are a single
path component of letters, digits, `.`, `_`, or `-`. The registration
(`service.json`) and lock (`service.lock`) live in that directory. They only
default to a temporary directory when no home directory exists, because macOS deletes unaccessed regular files
there after three days. The socket defaults to `/tmp/opencode-pty-<uid>/` to fit
socket path limits; temporary cleaners skip sockets. A stopping daemon removes
its own files and runtime directory, and a starting daemon removes abandoned
sibling runtime directories older than ten minutes.

On Unix, set `OPENCODE_PTY_SOCKET_DIR` to use a different socket directory. The
value must be an absolute path without `..` components. Sockets go in an
`opencode-pty-<uid>` child of that directory, which gets the existing ownership
and symlink checks and mode `0700`; the directory itself is left unchanged.
Socket path length limits still apply. Registration and lock files continue to
use the runtime directory.

### Local transport boundary

`src/transport/` owns endpoint listening/connecting, byte-stream I/O,
disconnect monitoring, response completion, and cancellation. Authentication,
protocol framing, dispatch, subscriptions, and ownership stay shared in the
daemon; runtime-directory/registration wiring is platform-specific. The Unix
backend preserves half-close when completing subscriptions so queued final
frames are not discarded on macOS. Shutdown cancellation is a separate operation
that wakes partial requests and blocked subscription writes before joining.
On Unix the daemon loop sleeps in `poll(2)` on the listener and a private wake
socket pair until a connection arrives, a stop or ownership change wakes it, an
ownership deadline is due, or a two-second safety net elapses. Windows still
polls every 10 ms.

The Windows named-pipe backend keeps protocol 7 and the registration fields
`instance_id`, `pid`, `protocol`, `socket`, and `token`. Treat `socket` as an opaque
local endpoint: on Windows it is `\\.\pipe\opencode-pty-<instance_id>`, not a
filesystem socket. A random per-instance name, exclusive first pipe instance,
current-user access control, and rejection of remote clients protect the endpoint;
the private registration file remains the discovery and authentication source.
The pipe is full-duplex and byte-mode, with overlapped reads/writes capped at
64 KiB per kernel operation. Accept polling never waits for a client; connect
retries are bounded to five seconds. Each pending operation is cancelled and its
completion reaped before its buffers or event are freed.
The kernel-retained `OVERLAPPED` allocation uses an owned raw pointer, not a
retained borrow from a movable `Box`; it is reclaimed only after I/O completion.
The allocation helper's move/repeated-access behavior is checked under both
Miri borrow models alongside the callback ownership tests.

Named pipes have no half-close. Protocol clients close after reading an ordinary
response or the final subscription event. Completion retains queued bytes while
waiting for that close, with a two-second grace period and daemon cancellation;
it never calls the potentially unbounded `FlushFileBuffers`. Stopping acceptance
retains a pipe instance until registration is removed, preventing namespace
squatting during cleanup.

On Windows, `opencode-pty daemon --name NAME [--runtime-dir DIR]` uses the same
`DIR/NAME` runtime directory; the default `DIR` resolves through `XDG_STATE_HOME`
or the user profile's `.local\state\opencode\pty`, matching OpenCode's state
directory. The runtime directory must be absolute. Storage entries must not be
reparse points or owned by another user; the directory, lock, and registration
use protected current-user-only ACLs, and clients verify the registration's owner
and ACL before trusting it. The held directory/lock handles deny delete sharing,
and registration is atomically replaced under the exclusive lock. Stale
registration is replaced with a fresh instance ID, token, and pipe name; cleanup
removes registration only if its instance ID still matches, then removes the lock
file and runtime directory after releasing their handles. The abandoned-sibling
sweep is shared with Unix; it checks liveness through the registered process
object and has no endpoint file to remove.

Registration publication uses `FileRenameInfoEx` with POSIX rename semantics,
so the runtime directory must be on a local NTFS volume (Windows 10 1709 or
later); there is no non-atomic fallback.

The Windows Rust `TerminalClient` and interactive CLI are not ported. Integrations
can use protocol 7 directly and the minimal `daemon::PipeConnection` byte-stream
helper. Connect with `PipeConnection::connect_to(socket, pid)`, which rejects a
pipe whose server is not the registered daemon process: after a crash the stale
registration's pipe name is free for another local user to create. Integrations
in other languages must make the same `GetNamedPipeServerProcessId` check before
sending the token. Discard a connection after any read/write timeout.

## Architecture

```text
opencode-pty process
├── atomic private service registration
├── authenticated framed IPC
├── terminal registry
├── terminal 1
│   ├── reader thread
│   ├── actor/libghostty thread
│   ├── writer thread
│   └── child-wait thread
└── terminal 2
    ├── reader thread
    ├── actor/libghostty thread
    ├── writer thread
    └── child-wait thread
```

The actor owns:

- `portable-pty` master control and resize
- `libghostty-vt::Terminal`
- Bounded raw replay and absolute output offsets
- Parsed screen, cursor, modes, title, and scrollback
- Terminal lifecycle and snapshot requests

The libghostty parser is authoritative for terminal-generated responses. Its
`on_pty_write` responses are sent through the same serialized writer path as
user input without blocking inside the callback.

## Playground

```sh
cargo run -- play --name play
```

Other service commands:

```sh
cargo run -- status --name play
cargo run -- list --name play
cargo run -- watch 1 --name play
cargo run -- stop --name play  # destructive: terminates every terminal
```

`play` starts and owns a new daemon; it cannot adopt an already running daemon.
`list`, `status`, `watch`, and `stop` only connect to an existing service and never
start one. `quit` stops the playground's daemon and terminals.

Commands:

```text
new [PROGRAM ARGS...]  create a terminal (default: your shell)
list                  list terminals and lifecycle state
use ID                choose the active terminal
run COMMAND           send a shell command and show parsed screen state
send TEXT             send bytes without Enter
screen [ID]           inspect authoritative libghostty state
replay [ID] [OFFSET]  inspect bounded raw replay safely
resize COLS ROWS      resize PTY and parser together
wait [MILLISECONDS]   wait and show active screen
kill [ID]             terminate and remove a terminal
demo                   prove terminal query responses end to end
help | quit
```

Try:

```text
demo
new
run printf '\033[32mgreen from the shell\033[0m\n'
new /bin/sh
list
use 1
screen
replay 1 0
resize 72 20
kill 2
quit
```

## Reading Terminal Rows

`TerminalService::read_rows(id, rows)` and `TerminalClient::read_rows(id, rows)`
return the last physical rows of the active terminal buffer, including its
retained scrollback. `rows: Option<u16>` defaults to the live terminal height
when omitted/`None`; zero is invalid. Counts larger than the available rows
return all available rows. Soft-wrapped rows stay separate, trailing whitespace
is trimmed, and blank rows (including trailing blank rows) are empty strings.
The alternate screen never exposes primary-screen history.

The protocol 7 request is `{"op":"read_rows","id":1,"rows":30}`;
omitted or `null` `rows` uses the current height. Its response is
`{"type":"rows","terminal":{...},"lines":[...],"cursor_x":0,"cursor_y":0}`.
Metadata, lines, and zero-based active-screen cursor coordinates come from one
actor snapshot. Reading does not move the viewport, change selection, or take
control. Existing snapshots, checkpoints, and replay are unchanged.

Row data is bounded to a 1 MiB budget counting JSON-escaped strings, array
punctuation, and owned-string slot overhead. An excessive result is an error,
not silently truncated. The existing 8 MiB transport-frame limit still applies
to the complete response including metadata.

## Verification

Install Git, Rust 1.90.0, and Zig 0.16.0. Normal builds do not need bindgen or
libclang and do not depend on a third-party Ghostty Rust crate.

```sh
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
printf 'demo\nlist\nquit\n' | cargo run -- play --name play
```

### Direct Ghostty bindings

`ghostty-revision` pins the official [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty)
source. `build.rs` fetches that commit, builds libghostty with Zig 0.16, and
links its static archive (`ghostty-vt-static.lib` on Windows, not the DLL
import library). It uses an isolated checkout under Cargo's build directory.
The package declares `links = "ghostty-vt"` so Cargo rejects dependency graphs
that try to link another native Ghostty owner alongside it.
Set `GHOSTTY_SOURCE_DIR` to reuse a checkout at that exact revision; modified
C headers are rejected to avoid silently mismatching the generated bindings.

`src/ghostty/ffi.rs` contains a generated subset of the official C API, with
layout assertions for the supported 64-bit platforms. `src/ghostty/mod.rs`
owns the terminal/formatter handles and exposes only the operations this
service uses. It keeps native objects actor-local, copies callback data,
defers title queries until parsing returns, catches callback panics before
they can unwind through C, and frees native buffers with Ghostty's allocator.
No borrowed grid reference or native handle is exposed to the service.

`src/ghostty/effects.rs` owns the callback state through `Rc`. Its retained
userdata pointer comes from `Rc::as_ptr`, and all state changes use interior
mutability through shared references. It stays alive through native teardown;
moving a terminal or draining replies never creates an exclusive borrow of the
callback allocation.

To update the native revision, edit `ghostty-revision`, check out that revision
of official Ghostty, and regenerate the declarations from its headers:

```sh
cargo install bindgen-cli --version 0.72.1 --locked
# Install libclang (or set LIBCLANG_PATH to its shared library directory).
script/ghostty-bindings /path/to/ghostty
cargo test --locked
```

Only regeneration needs bindgen/libclang. The build verifies that the
generated revision matches `ghostty-revision`; changing either alone fails
instead of silently combining different C APIs. The generated declarations
are covered by the upstream license in `src/ghostty/LICENSE`.

The callback ownership tests also run under Miri without building Ghostty. Their
small native-owner stand-in imports the production effects module directly and
exercises constructor/container moves, repeated callback/drain cycles, buffer
ownership, panic handling, and teardown. CI checks both Stacked Borrows and Tree
Borrows; the regular native suites still verify the actual C integration.

```sh
rustup toolchain install nightly-2026-09-02 --profile minimal --component miri --component rust-src
cargo +nightly-2026-09-02 miri test --locked --manifest-path tests/ghostty-effects/Cargo.toml
MIRIFLAGS=-Zmiri-tree-borrows cargo +nightly-2026-09-02 miri test --locked --manifest-path tests/ghostty-effects/Cargo.toml
```

### Windows CI

The Windows jobs in the monorepo's
`.github/workflows/check-process-daemon.yml` build for Windows x64 and ARM64 and execute
tests natively on `windows-2025` and `windows-11-arm`, respectively. The ARM64
job uses x64-hosted compilers targeting ARM64 because native ARM64 Zig 0.16
crashes while building Ghostty; the tests themselves remain native ARM64.
The job also applies a guarded one-line alignment fix to Zig 0.16's Windows
stack-trace helper, which otherwise fails to compile for ARM64.
The workflow runs on pull requests and pushes to `dev` that touch
`packages/process-daemon`, independently of the release workflow.
It checks formatting, builds the executable, runs all enabled tests, and checks
`opencode-pty.exe --version`. It also copies the library test executable out of
the build tree and runs it without Cargo's DLL search paths, verifying that
libghostty is statically linked. It does not publish packages or releases.

`tests/runtime.rs` exercises `TerminalService` directly on both Unix and Windows,
using real self-spawned Rust console children. It covers input/output, Unicode,
cwd/environment/argument and executable-path handling, OS console resize,
snapshots, bounded replay, terminal replies, and independent terminals. ConPTY
can consume application terminal queries itself; the tests also check its
cursor-inheritance query reaches our reader and Ghostty parser.

The reusable fixture in `tests/support/terminal_fixture.rs` returns a
`CreateTerminal` request and uses a separate control/observation channel, so
daemon tests can reuse it without a shell or Rust client. Include it as
`terminal_fixture`, call `Fixture::request`, create the terminal, then call
`Fixture::connect`. `Command::Output` writes real console stdout; `Command::Read`
observes actual console stdin without echo; `Size` and `Context` inspect the
child's OS console and process context. The ignored `child` test is only its
subprocess entry point, not skipped runtime coverage.

The original service, ownership, playground, and rows integration suites remain
Unix-only. Windows library tests exercise real named-pipe roundtrips, multiple
connections, namespace ownership, cancellation, final-frame completion, and
private atomic registration. `tests/windows-daemon.rs` exercises authenticated
ownership/handoff, locking/stale registration, partial requests, blocked
subscribers, and live ConPTY create/input/output/resize/shutdown through the real
daemon. Natural child-exit/ConPTY EOF and runtime cleanup are checked by the
direct runtime suite; the basic daemon tests do not establish complete lifecycle
coverage on their own.

On Windows, normal root-child exit hands the ConPTY master to the existing
child-wait worker for closing. The actor and reader continue draining until the
real output-pipe EOF; only then is the final exit event published. The worker
checks the root's wait handle at 10 ms intervals. After the master is handed
off, Windows input and resize requests fail with a child-exited error; final
snapshots, rows, and replay remain readable until the terminal is removed.
Unix post-exit PTY operations retain their existing behavior.

### Known Linux cleanup limitation

A child that exits without consuming a large queued PTY write can leave the
Linux master write blocked after the child, actor, reader, and waiter have
already stopped. `TerminalService::terminate` or service drop can then wait
indefinitely for the writer thread. This pre-existing Unix I/O limitation is
not repaired by the Windows cleanup work. A test watchdog or the daemon's
forced-exit deadline does not prove that those worker threads were joined.

The workflow can also be run manually against a branch:

```sh
gh workflow run check-process-daemon.yml --repo anomalyco/opencode --ref BRANCH
gh run list --repo anomalyco/opencode --workflow check-process-daemon.yml --branch BRANCH
gh run view RUN_ID --repo anomalyco/opencode --log-failed
```

## Releases

Releases are built by
[`.github/workflows/release-process-daemon.yml`](../../.github/workflows/release-process-daemon.yml)
in anomalyco/opencode. To release version `X.Y.Z`:

1. Bump `version` in `Cargo.toml` (and `Cargo.lock`), and `version` plus every
   `optionalDependencies` entry in `npm/package.json`, to `X.Y.Z`. The workflow
   fails if any of them disagree.
2. Merge the bump to `dev`.
3. Push a `process-daemon-vX.Y.Z` tag at the merged commit:

```sh
git tag process-daemon-vX.Y.Z
git push origin process-daemon-vX.Y.Z
```

The tag creates an unsigned GitHub release titled `process-daemon vX.Y.Z`. It
is never marked Latest, because the monorepo's Latest release drives
OpenCode's own update paths. The release contains x86-64 and arm64 binaries
for Linux GNU, Linux musl, macOS, and Windows (MSVC, statically linked C
runtime), plus `SHA256SUMS`, a machine-readable `release-manifest.json`, and
GitHub build-provenance attestations. Release builds force Ghostty's Zig code
generation to its baseline CPU target so artifacts do not inherit
instruction-set extensions from CI runners (Windows builds set
`OPENCODE_ZIG_CPU=baseline`, since the Unix Zig wrapper is a shell script).
Linux GNU artifacts support glibc 2.30 and newer.

Tagged releases also publish `@opencode-ai/pty` to npm with optional,
platform-specific binary packages. Installing the npm package selects the native
binary for the current platform (`opencode-pty.exe` on Windows) and exposes
its path as `binaryPath`:

```js
import { binaryPath } from "@opencode-ai/pty"
```

npm publishing uses trusted publishing with provenance. Each of the nine
packages (`@opencode-ai/pty` and the eight `@opencode-ai/pty-<platform>`
packages) must list anomalyco/opencode with workflow
`release-process-daemon.yml` as its trusted publisher.

Pull requests that change the release pipeline run the same build and npm
packing without publishing anything.

Platform signing will be added later.

## Current Limits

- Windows supports the daemon/protocol transport, not the Rust interactive
  TerminalClient/play/watch CLI.
- Ordinary API operations use one framed JSON request per connection;
  subscriptions keep the authenticated connection open for ordered live events.
- The OpenCode backend proxy and ordered group APIs are implemented, but the
  OpenTUI client integration is not.
- Windows uses portable-pty's published ConPTY backend and is not hardened yet.
- Child process-tree cleanup is not complete beyond portable-pty's root killer.
- Cold-client checkpoint transport is not implemented.
- A service-process crash loses all terminals by design.
