# W2: `TZ` on a Windows without ICU is read in POSIX syntax

**TypeScript.** Bun and Node on Windows take local times from ICU. Without `TZ` they use the Windows time zone with
its whole rule history; a `TZ` that is set is read as an IANA name, such as `TZ=America/New_York` (an empty one is
UTC).

**Rust.** `crates/util/src/time.rs` takes the local offset from the ICU that Windows ships (`icu.dll` since Windows
10 1903, `icuin.dll` since 1703), loaded at first use through `win::IcuZone`, so it reads `TZ` and the Windows zone
as TypeScript does. Only where neither library loads does it fall back to the C runtime's `localtime_s`, which reads
`TZ` in POSIX syntax (`EST5EDT`), so an IANA name is misread, usually as UTC, and applies this year's rules of the
Windows zone to every year.

**Reason.** Windows before 10 1703 has no system ICU, and reading IANA names without it needs the zone database or a
new dependency. Every supported Windows has `icu.dll`.
