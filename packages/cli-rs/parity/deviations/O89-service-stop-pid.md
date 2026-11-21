# O89: `service stop` checks the registered process before signalling it

**TypeScript.** `Service.stop` reads the registration and `terminate` sends SIGTERM, then SIGKILL, to its `pid`
after only comparing the file with a second read of the same file (`packages/client/src/effect/service.ts:129-197`).
A registration left behind by a crash or reboot names a pid that another process may own now, and `service stop`,
`restart`, or a config edit that stops the service signals that process.

**Rust.** `stop::stop` signals a live registered pid only when it is the registered process. On Linux the process
must have started no later than the registration file was last written (one second of slack for `/proc` clock
ticks). Elsewhere, or when `/proc` cannot be read, the URL must answer `/api/info` with the registered pid, or accept
the connection and not answer in time (a hung service). Otherwise the command fails with "Process N is not the
OpenCode server registered in FILE, so it was not stopped. Remove that file if the server is gone." and leaves the
file. A dead pid is handled as before: the stale file is removed. `ensure` still stops only a process it started
itself, which it holds a handle to.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.
