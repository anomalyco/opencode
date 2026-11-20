# L01: JSONC edge cases in broken or unusual files

**TypeScript.** `jsonc-parser` keeps a lone UTF-16 surrogate escape (`"\ud83d"`) as a lone surrogate, and
`JSON.stringify` writes it back as `\ud83d`. Removing an array index past the end of a multi-item array throws a
JavaScript `TypeError`. An unclosed block comment at the end of a file makes a token one unit longer than the
text.

**Rust.** `crates/local/src/jsonc.rs` decodes a lone surrogate as U+FFFD, because Rust strings cannot hold one.
The out-of-range removal fails with `Can not remove Array index <n> as length is not sufficient`. The unclosed
comment token ends at the end of the text. A container nested deeper than 512 levels is a parse error, so the
file is invalid, and an edit of it fails with `Can not edit a document nested deeper than 512 levels`;
`jsonc-parser` reads about 10,000 levels and throws a stack `RangeError` past that. Every case in
`parity/oracle/F.5-config.ts jsonc` (293: edits, parses, and parse errors) is byte-equal.

**Reason.** These inputs are broken documents; `cli.json` updates fail on them in both clients. The recursive
parser would overflow the stack and abort the process past a few thousand levels, and formatting an edit
indents every level of its lines, so its text grows with the square of the depth. The rest of the library is
ported line by line.
