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
- A user title set by rename takes precedence over OSC titles; title changes publish only when the effective title changes.
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
- Current effective title and user title
- Current foreground process derived from PTY process state

No borrowed libghostty object crosses a thread boundary.

## Row Reads

`Request::ReadRows { id, rows: Option<u16> }` (`op: "read_rows"`) returns
`Response::Rows { process, lines, cursor_x, cursor_y }` (`type: "rows"`). Both
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
responses remain subject to the transport's 8 MiB frame limit.

## Titles

`pty.title` is the effective title: the user title, else the latest
OSC 0/2 title, else the title given at creation. An empty OSC title (a program
resetting it) or an empty user title counts as unset. `pty.user_title` is
always serialized, as `null` when unset.

`Request::Rename { id, title: Option<String> }` (`op: "rename"`) sets the user
title, or clears it when `title` is null or empty, and returns `Response::Ok`.
The terminal actor handles it as one command, so it is ordered with output.
OSC titles keep being tracked while a user title is set and show through again
once it is cleared.

Rename and OSC updates publish `TitleChanged` with the effective title only
when it changes; an OSC change hidden behind a user title publishes nothing.

## Processes

Every process, PTY or pipe, is described by `ProcessInfo`:

- `id`, `mode` (`"pty"` or `"pipe"`), `pid`, `command` (program and
  arguments), `cwd`, `group_id` (an opaque string), `lifecycle`,
  `output_head` and `output_tail` (absolute byte offsets), `started_at` and
  `exited_at` (milliseconds since the Unix epoch; `exited_at` is `null` until
  the exit is final, that is until `Exited` is sent, and never before
  `started_at`).
- `pty`, set only for PTYs: `title`, `user_title`, `foreground_process`,
  `cols`, `rows`.
- `pipe`, set only for pipe processes: `output_path`, `output_lines`,
  `output_error` (left out when there is none) and `metadata`.

Exactly one of `pty` and `pipe` is present, matching `mode`; the other key is
left out.

`list { mode }` (`mode` required) returns the processes of that mode in
creation order as `Response::Processes { processes }`. `get { id }` returns one
process of either mode as `Response::Process { process }`, or an error for an
unknown id. Both refresh a PTY's foreground process first.

`Created`, `Snapshot`, `Rows` and `Attached` carry the info as `process`.

## Pipe Processes

`create_pty { program, args, cwd, env, group_id, title, cols, rows }` starts a
PTY. `create_pipe { program, args, cwd, env, group_id, output_path, metadata }`
starts a pipe process: any command without a terminal. Both return
`Created { process }`. Pipe processes work on Unix and Windows.

- The child gets exactly `env`: the daemon's own environment is not
  inherited, and no `TERM` or `COLORTERM` is added. `cwd` must be absolute.
- The child gets no terminal: stdin is `/dev/null` on Unix and `NUL` on
  Windows, and both stdout and stderr share one pipe, so their bytes stay in
  order. Nothing parses the output: there is no emulator, no terminal replies,
  no OSC title and no foreground process.
- On Unix the child gets its own process group and an empty signal mask with
  default actions (the daemon blocks SIGTERM and SIGINT, and std keeps the
  mask across exec). On Windows it is created with `CREATE_NO_WINDOW` (no
  console) inside a kill-on-close job. For a bare executable name,
  `CreateProcessW` searches the directory containing the daemon executable,
  the daemon's current directory, the 32-bit and then 16-bit Windows system
  directories, the Windows directory, and finally the directories in the
  daemon's `PATH`. This search is independent of the request's `cwd` and `env`,
  which set the child's working directory and environment. To invoke a shell,
  the caller must request one explicitly, e.g. `cmd.exe` with `["/c", command]`.
- `output_path` must be absolute. The daemon opens it before spawning,
  truncating an existing file or creating one (mode `0666` minus the daemon's
  umask on Unix), and refuses a symlink or other reparse point as the final
  path component. The request is validated (program, absolute paths, metadata
  size) before the file is opened, so such a rejected request never creates or
  truncates it; a path that cannot be opened fails the request without
  starting the process. A missing program or `cwd` fails at spawn, after the
  file was opened. The file is opened for reading, writing and deletion by
  other handles, so a reader can follow it and the owner can delete it while
  the process still runs.
- The reader writes every output byte to the file before handing it to the
  actor. The file is the only copy of the output: a pipe process has no replay
  buffer, so `replay` and `subscribe` return an empty replay (with correct
  offsets) and live events only. Output never needs to cross the socket.
- A write error stops the file and sets `pipe.output_error`; the process keeps
  running and its output is still counted in the offsets.
- `write`, `resize`, `control`, `input`, `snapshot`, `read_rows` and `rename`
  fail for pipe processes; `wait`, `signal` and `set_metadata` fail for PTYs.
- Exit is published once both the exit status and the end of output are known.
  A descendant that keeps the pipe open (`cmd &`, dev servers) delays that by
  at most one second after the child exits; the reader then closes the pipe,
  so leftover writers get `SIGPIPE`/`EPIPE` on Unix and a broken pipe on
  Windows. This is deliberate: the process is reported as finished, and
  nothing reads what comes later. The file is closed before the exit is
  published.
- `Exited` and the lifecycle carry `signal`, the signal's name such as
  `"SIGTERM"`, when a signal ended the process (on Windows, when the daemon
  signalled it); `exit_code` is then null. `signal` is left out when there is
  none.
- On Unix an exited pipe process stays listed, as a zombie, until `terminate`.
  The zombie keeps its PID and process group ID reserved, so killing the group
  can never reach an unrelated process. On Windows the process object and job
  handle stay open until `terminate`, so the PID is not reused either.
  `terminate` kills the whole tree (SIGKILL on Unix; the job on Windows),
  reaps it and removes the process; it never waits on a descendant that left
  the process group or job and still holds the pipe. The daemon never deletes
  output files.

### Line count

`pipe.output_lines` counts the `\n` bytes written to the file. The reader
counts them in each successfully written slice (including a partial write
before an error), and the actor adds them in the same step that advances
`output_tail`, under the same lock, so `get` and `list` always return a
matching pair. After a write error nothing more is counted.

The file can hold a little more than `output_tail`, since the reader writes
before the actor counts: read only up to `output_tail` when pairing bytes with
the count. After `Exited` the file is closed and its size equals
`final_offset`, unless `output_error` is set: output read after a write error
still advances `output_tail` and `final_offset` but is not in the file, so use
the file's real size.

### Wait, signal and metadata

`wait { id }` (pipe only) is held open until the process exits, then answered
with one `Exited` and closed. It never sends output. A process that already
exited is answered at once, so `list` followed by `wait` after a server
restart cannot miss an exit. An unknown id or a PTY is answered with an
`Error` at once. If the process is terminated first, the reply is
`Error { message: "terminated" }`; if the daemon stops, the connection closes
without a reply. Several waiters may wait on one process.

`Exited` carries `exit_code`, `signal`, `final_offset`, `output_lines` (pipe
only; left out for PTYs), `output_error` (left out when there is none) and
`exited_at`. PTY subscriptions send the same response.

`signal { id, signal }` (pipe only; `"SIGTERM"`, `"SIGINT"` or `"SIGKILL"`)
signals the process tree and returns `Ok`. On Unix the signal goes to the
process group and the child, as a real signal. **On Windows every signal is a
hard kill** of the job: there is no console, so SIGTERM and SIGINT cannot be
caught, and the exit reports the signal that was sent, not a platform exit
code. Unlike `terminate`, `signal` keeps the process: `wait` then gets a normal
`Exited` with `signal`. Signalling an exited process is allowed and reaches
whatever is left of its group or job (an empty group is not an error); after
`terminate` the process is gone and `signal` fails.

If an outer job refuses the child (`ERROR_ACCESS_DENIED`, for example a job
with UI restrictions), the daemon runs the command anyway without a job, logs
a warning once, and kills only the main process; descendants then survive a
signal or terminate.

`metadata` on `create_pipe` is an opaque JSON object the daemon stores and
returns as `pipe.metadata` without interpreting it. `set_metadata { id,
metadata }` (pipe only) replaces it and returns `Ok`. Both reject metadata
over 1 MiB of serialized JSON.

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

Protocol v8 uses four-byte big-endian framing with bounded UTF-8 JSON control
frames and tagged raw binary output frames. Requests (`op`): `ping`, `own`,
`prepare_handoff`, `create_pty`, `create_pipe`, `list`, `get`, `wait`,
`signal`, `set_metadata`, `write`, `resize`, `control` (atomic interaction
promotion), `input`, `snapshot`, `read_rows`, `rename`, `replay`, `subscribe`
(replay-to-live, with title, resize, controller and exit events),
`terminate` and `shutdown` (destructive).

A request the daemon cannot parse is answered with
`Error { message: "unsupported request: <op>" }` for an unknown `op` (or
`"invalid <op> request: ..."` for bad fields) instead of dropping the
connection, once the token has been checked. Clients can therefore probe for
a request.

`Pong` and the registration carry `features` (required), the daemon's additive
capabilities. Protocol 8 needs none, so the list is empty. Later additive
changes, such as a new request or field older clients can ignore, extend
`features` and keep the protocol version. Only breaking changes bump
`PROTOCOL_VERSION`, which clients reject on mismatch.

Registration is written atomically with private permissions and contains an
instance ID, PID, protocol version, features, socket path, and random credential. A
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
the database. It starts the daemon only when the first terminal or pipe
process is created.
Only an explicit restart handoff descriptor lets a replacement server reuse
the previous daemon's runtime directory and claim its ownership.
