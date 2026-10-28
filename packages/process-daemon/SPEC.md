# Threaded PTY Service Core

Status: threaded core and persistent service API implemented

## Objective

Prove that one Rust service can own multiple portable PTYs while each terminal
uses isolated blocking threads, authoritative libghostty parsing, bounded raw
replay, and explicit lifecycle state.

## Invariants

- One reader consumes each PTY output stream.
- One writer serializes every byte written to each PTY.
- libghostty state is created, accessed, and dropped on one actor thread.
- libghostty callbacks never perform blocking PTY writes or IPC.
- Actor and writer channels are bounded.
- Raw replay is bounded and uses absolute byte offsets.
- Replay truncation is explicit.
- PTY resize and parser resize occur in one ordered actor command.
- Every resize publishes an authoritative post-resize VT checkpoint before subsequent output.
- Child exit and PTY EOF are separate events.
- One terminal exiting does not stop the service or another terminal.
- Service shutdown attempts to terminate and join every terminal runtime.
- A terminal has at most one controller; observers cannot write or resize until interaction promotes them.
- Promotion demotes the previous controller without closing its subscription.
- Promotion, canonical resize, and input are one ordered actor command.
- Subscription replay and live events cross one ordered actor boundary.
- OSC 0/2 title changes update authoritative terminal metadata and publish ordered subscription events.
- The deepest TTY-attached process in the foreground process group updates authoritative process metadata.
- Controller delivery applies backpressure; observers tolerate bounded output bursts and are disconnected when their backlog remains full.
- Adjacent output is coalesced before fanout, flushing at 8 KiB, after 1 ms, or before the next non-output event.

## Data Flow

```text
child PTY output
  -> blocking reader thread
  -> bounded actor queue
  -> append bounded raw replay
  -> libghostty vt_write
  -> collect parser responses
  -> bounded writer queue
  -> blocking writer thread
  -> child PTY input
```

User input also enters through the actor and the same writer queue.

## Snapshot

A snapshot is built on the actor thread and contains owned values only:

- Terminal metadata and lifecycle
- Rows and columns
- Cursor position
- Plain parsed screen text
- VT checkpoint synthesized by libghostty formatter
- Raw replay head and tail offsets
- Current title derived from libghostty state
- Current foreground process derived from PTY process state

No borrowed libghostty object crosses a thread boundary.

## Row Reads

`Request::ReadRows { id, rows: Option<u16> }` (`op: "read_rows"`) returns
`Response::Rows { terminal, lines, cursor_x, cursor_y }` (`type: "rows"`). Both
the service and Rust client expose `read_rows(id, rows)`. Omitted or null rows
defaults to the current terminal height; zero is rejected. A larger count
includes retained history, up to all available rows of the active buffer.
Counts cannot exceed `u16::MAX`.

The actor selects the last physical rows using libghostty's total active-buffer
row count and full-screen grid coordinates, independent of the viewport.
Each row is formatted separately as plain text with soft-wrap unwrapping
disabled and trailing whitespace trimmed. Blank rows remain empty strings,
including internal and trailing blanks. Alternate-screen reads cannot include
primary-screen history. Resizes are observed in actor order, including reflow.
Rows, terminal metadata, and zero-based active-screen cursor coordinates are
captured in the same actor command. Cursor coordinates are not rebased to the
returned history rows. No viewport, selection, controller, snapshot,
checkpoint, or replay state is changed.

Row reads have a 1 MiB budget for JSON-escaped row strings, array punctuation,
and owned-string slots (including blank rows); formatting buffers are also
bounded. Results exceeding that budget fail rather than truncate. Complete
responses remain subject to the transport's 8 MiB frame limit. Protocol 7
supports `read_rows` alongside the existing snapshot and replay operations.

## Failure Boundary

Losing the owning server connection stops `opencode-pty` and its terminals.
An explicitly prepared restart handoff allows a replacement server to claim
the same daemon before a fixed deadline. If `opencode-pty` itself dies, its
terminals may die; live replacement of the daemon is not supported.

## Persistent Service Boundary

Every daemon requires one authenticated owner connection within five seconds
of startup. Owner loss stops the daemon unless a handoff was prepared on that
connection. Handoff tickets expire 120 seconds after preparation and are
consumed by successful replacement ownership. A valid ticket replaces even a
connected owner; the superseded connection can no longer prepare handoffs or
stop the daemon, and its disconnect does not affect the new owner. The playground holds ownership until it exits; other CLI commands
only observe or operate an existing daemon and never start one.

Protocol v7 uses four-byte big-endian framing with bounded UTF-8 JSON control
frames and tagged raw binary output frames. It supports ping, create, list,
write, resize, atomic interaction promotion, snapshot, read_rows, replay, replay-to-live
subscriptions, title updates, controller takeover, terminate, and destructive service
shutdown, ownership acquisition, and restart handoff preparation.

Registration is written atomically with private permissions and contains an
instance ID, PID, protocol version, socket path, and random credential. A
service lock elects one process and protects stale socket cleanup. On Unix, the
socket uses a fixed-length hash of the canonical runtime path
under a private per-user `/tmp` directory to stay below platform path limits.

Every command requires `--name NAME`; the runtime directory is `DIR/NAME`,
where `--runtime-dir DIR` defaults to OpenCode's state directory,
`${XDG_STATE_HOME:-~/.local/state}/opencode/pty`. A name is one path component
of letters, digits, `.`, `_`, or `-`. Registration defaults to a temporary directory only when no home
directory can be found: macOS deletes regular files there that are unaccessed for three
days, even while the daemon runs. Temporary cleaners skip sockets, so the
socket stays in `/tmp`. On exit the daemon removes its registration and socket
only if they are still its own, then its empty runtime directory. At startup
it removes sibling runtime directories in `DIR` that are over ten
minutes old, contain only registration files, and have either a lock it can
acquire or, without a lock file, a valid registration whose PID no longer
exists. Directories without that evidence, including empty ones, are kept.

On Windows the endpoint is a random per-instance named pipe instead of a
socket. The runtime directory, lock, and registration carry a protected
current-user-only ACL, and registration is atomically replaced with POSIX
rename semantics. Clients verify the registration's owner and ACL, and check
that the pipe server process matches the registered PID before sending the
token. On exit the daemon removes its registration if still its own, then the
lock file and runtime directory; the forced-exit watchdog removes only the
registration, leaving the rest to a later sweep. The sweep checks liveness
through the registered process object.

OpenCode chooses a fresh UUID runtime directory for each server, independent of
the database. It starts the daemon only when the first terminal is created.
Only an explicit restart handoff descriptor lets a replacement server reuse
the previous daemon's runtime directory and claim its ownership.
