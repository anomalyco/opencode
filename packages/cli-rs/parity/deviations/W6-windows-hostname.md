# W6: the lock's `hostname` on Windows is the NetBIOS name

**TypeScript.** `packages/util/src/flock.ts:208` writes `os.hostname()` into a lock's `meta.json`. On Windows
that is the DNS host name, such as `build-machine-01`.

**Rust.** `crates/local/src/lock.rs` (`hostname`) reads `COMPUTERNAME` on Windows: the NetBIOS name, in upper
case and at most 15 characters, such as `BUILD-MACHINE-0`. On Unix both read `uname`'s node name.

**Reason.** The field is metadata only: no client reads it to decide who owns a lock, and the token and PID do
that. The DNS name needs `GetComputerNameExW` and a new `windows-sys` feature for no change in behaviour.
