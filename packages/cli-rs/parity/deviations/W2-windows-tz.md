# W2: `TZ` on Windows is read in POSIX syntax

**TypeScript.** Node on Windows takes local times from ICU. Without `TZ` it uses the Windows time zone; a `TZ`
that is set is read as an IANA name, such as `TZ=America/New_York`.

**Rust.** `crates/util/src/time.rs` takes the local offset from the C runtime's `localtime_s`. Without `TZ` it also
uses the Windows time zone. A `TZ` that is set is read in the C runtime's POSIX syntax (`EST5EDT`), so an IANA
name is misread, usually as UTC. Not yet observed on Windows; the runner (W3) checks it.

**Reason.** Reading IANA names needs the zone database, which Windows does not ship to the C runtime, or a new
dependency. Setting `TZ` on Windows is rare; without it Rust and TypeScript agree.
