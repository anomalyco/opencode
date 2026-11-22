# C11: the ACP agent reads JSON as serde_json does, not as `JSON.parse`

**TypeScript.** The ACP SDK reads each line with `JSON.parse`. A lone surrogate escape (`"\ud800"`) stays a lone
surrogate, a number past the double range (`1e400`) reads as `Infinity` (written back as `null`), and any depth of
nesting parses. A number keeps only its value: `1.0`, `1E2` and `-0` are written back as `1`, `100` and `0`.

**Rust.** `opencode-native acp` reads each line with serde_json. A line with a lone surrogate escape, a number past
the double range, or nesting deeper than 128 levels is a parse error: the agent answers `-32700 Parse error` with a
null id, as for any other line that is not JSON, and reads the next line. A number keeps its written form, so an id
`1.0` is answered as `1.0`. Every other line reads the same.

**Reason.** Rust strings cannot hold a lone surrogate, and serde_json bounds nesting to keep its recursive parser off
the stack's end. ACP clients write their messages with a JSON library (Zed with serde_json), so none of these reach
the agent. The prop-cli wire hunt compared both agents over generated lines and found no other difference.
