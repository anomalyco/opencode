# W5: `session list` on Windows pages through the system `more.com`

**TypeScript.** On a Windows terminal, `session list` pipes the table into `cmd /c more`
(`packages/cli/src/commands/handlers/session/list.ts`). `cmd` looks for `more` in the current directory before
`PATH`, so a `more.bat` or `more.exe` in the project runs with the session list on its stdin.

**Rust.** `crates/cli/src/commands/session.rs` (`pager`) starts `%SYSTEMROOT%\System32\more.com` directly
(`C:\Windows` when the variable is unset). If it cannot start, the list is printed, as before.

**Reason.** Decision O-89: a defect the TS client shares is fixed in Rust. Listing sessions in an untrusted
checkout must not run code from that checkout. The pager the user sees is the same program.
