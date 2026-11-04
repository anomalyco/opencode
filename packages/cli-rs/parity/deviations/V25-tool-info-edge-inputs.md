# V25: tool summaries on malformed or Windows inputs

TypeScript: `toolInlineInfo` (`packages/tui/src/mini/tool.ts:1194`) works on untyped JSON. A few
inputs that no current server writes take paths the Rust port does not copy:

- A non-string `patch` in edit metadata, or a non-string `diff`, becomes the `body` as it is
  (`runEdit`, `tool.ts:410-418`). A part whose state has a `content` that is not an array throws
  outside the rule's `try` (`frame`, `tool.ts:1132`), so the caller fails.
- `toolPath` uses `path.win32` when the base directory is a Windows path
  (`packages/tui/src/util/path-format.ts:19-24`).

Rust (`crates/ui/src/tool_info.rs`): a non-string `patch` or `diff` gives no body. Content that is not
an array reads as no content. Paths use POSIX rules for every base directory; a Windows input under
a POSIX base keeps the TS behavior (backslashes become slashes).

Reason: the `body` field is a string in both clients, and failing the whole summary on a bad
`content` would hide the tool line. Windows bases come with platform support (Q10, later). Every
other input, including values that make a TS rule throw and fall back, matches the TS output: the
P-ORACLE (`parity/oracle/U.5-tool-info.ts`) covers 60 parts and 5,827 recorded parts from real
sessions matched.
