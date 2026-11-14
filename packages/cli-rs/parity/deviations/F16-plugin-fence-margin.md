# F16: a blank row before a plugin's fence

**TypeScript.** Core's top-level Markdown (`internalBlockMode: "top-level"`, which the transcript uses) means to give
a custom block `Math.max(its own marginTop, the block's)`, one row after any block. A renderable with no margin of its
own reports `marginTop` as `NaN` (`@opentui/core` 0.8.4, `createTopLevelRenderable`), so the result is `NaN` and the
block gets no margin. A code-block renderer that sets no margin (`markdown.registerCodeBlockRenderer`) is drawn on the
row after a paragraph, a list, a heading or another such fence, with no blank row between. A block after the fence
still gets its row. The built-in LaTeX and Mermaid renderers set `marginTop: 1` themselves to get the row
(`packages/latex/src/markdown.ts`, `packages/merman/src/markdown.ts`).

**Rust.** opentui-rust's `Markdown` puts one blank row between any two blocks, a plugin's fence included, and none
before the first. A fence a plugin draws (`Setup::code_block`, a fence claim) has no margin of its own. So it has the
row TS gives its built-ins and what Core's code intends, wherever it is.

**Reason.** Decision O-89: a defect the TS client shares is fixed in Rust. Text drawn against a block is a
visible defect, and TS's own renderers work around it. `parity/scenarios/P.2/plugin-fence-margin.app.ts` drives it:
four fences with no margin, after a paragraph, after another fence, and after a list, are four rows lower in Rust and
otherwise equal. A TS renderer that sets its own margin, as LaTeX and Mermaid do, matches Rust between blocks
(`P.2/fence-margin`); a fence that opens a message differs as `F13-latex-leading-row.md` says.
