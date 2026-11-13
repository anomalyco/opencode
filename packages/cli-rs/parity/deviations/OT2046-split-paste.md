# OT2046: a paste whose start marker is split by a pause stays a paste

TypeScript: `@opentui/core` 0.8.4's native input parser. When the bracketed-paste start marker `ESC [ 200 ~` arrives
in two reads with a pause between them, the parser does not join them: the rest of the marker and the pasted text
are typed as keys, and the line break is lost. In `parity/scenarios/OT/split-paste.pty.ts` (`ESC [20`, 300 ms, then
`0~one CR two ESC [201~`), the TS prompt reads `hi 0~onetwo`.

Rust: the client pins OpenTUI `d3da53173` (anomalyco/opentui#2046). A cut start marker waits for its rest, so the
paste arrives whole: the prompt reads `hi one` and `two` on the next row, and the prompt grows by one row. A paste
whose marker arrives in one read is the same on both sides.

The same pull request changes how a raw Escape at the end of a read joins the next read on terminals that confirm
the Kitty keyboard protocol. That part shows no difference from TS: with Escape alone, then `[TODO] Please`, `OA` or
`[a` in later reads, both clients type the text as sent (driven once in P-PTY; TS 0.8.4's parser does not have the
defect #2046 fixes there).

Reason: TS's behavior is a defect of the shared native parser. The difference goes away when TS moves to an
`@opentui/core` release that includes #2046.
