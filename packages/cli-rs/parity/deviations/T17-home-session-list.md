# T17: the T.1 home lists sessions

TypeScript: the home (`packages/tui/src/routes/home.tsx`) shows the logo, the prompt with a random
placeholder ("Ask anything… …"), the prompt footer with the directory, branch, and hints, and the version in
the bottom right corner. It lists no sessions; the session list is a dialog (DLG14).

Rust: T.1's stand-in home (`crates/tui/src/routes/home.rs`) shows "opencode", a `Select` with the directory's
root sessions (title and ID, newest first), and a hint line ("enter open · ctrl+p commands · ctrl+c exit").
P-APP `H.2/home-sessions`, checkpoint `home`, differs in nearly every row.

Reason: not built yet. T.1 built a minimal home so the shell could be used; E.1 replaces it with the TS home
(T17) and then removes this file and the `deviation` entry of that checkpoint.
