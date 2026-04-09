### Issue for this PR

Closes #14966

Related: #18394
Overlaps: #20400
Upstream dependency/work: anomalyco/opentui#735, anomalyco/opentui#736, anomalyco/opentui#737

### Type of change

- [x] Bug fix
- [ ] New feature
- [ ] Refactor / code improvement
- [ ] Documentation

### What does this PR do?

This wires `detectLinks` into the non-experimental markdown `<code filetype="markdown">` path in the TUI session view.

That change makes tree-sitter markdown chunks carry hyperlink metadata, so OpenTUI emits OSC 8 links for markdown URLs in this path instead of relying on terminal URL auto-detection that breaks at visual wraps.

### Strategy updates from wrap-hyperlink learnings

- Fix hyperlink continuity in the render pipeline where text chunks are created, not in click fallback code.
- Keep markdown URL handling explicit (`onChunks={detectLinks}`) so wrapped URL segments remain one logical target.
- Treat terminal auto-detection as non-contractual for wrapped URLs; require OSC 8 metadata at source.
- Separate ownership by layer:
  - opencode markdown path emits link metadata
  - opentui renderer preserves wrapped link grouping
  - terminal behavior is compatibility validation, not the primary fix site
- Follow a wrap-link verification matrix: plain URL, markdown link label/url, wrapped URL, wrapped table-cell URL, and modifier-hover click behavior.
- Track upstream rendering behavior and known terminal constraints separately:
  - OpenTUI renderer/link detection behavior: anomalyco/opentui#736
  - Existing app-level issue and overlap context: #14966, #18394, #20400
  - Terminal behavior references: ghostty-org/ghostty#2780, ghostty-org/ghostty#1197, ghostty-org/ghostty#2114

### How did you verify your code works?

- `lsp_diagnostics` reports no errors for `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- `bun typecheck` passes in `packages/opencode`
- `bun run build` passes in `packages/opencode`
- `bun test --timeout 30000` runs and currently has one unrelated environment-sensitive failure in `test/tool/write.test.ts` (`0644` expected vs `0640` with shell `umask 0027`)

### Screenshots / recordings

_Not a UI screenshot change._

### Checklist

- [x] I have tested my changes locally
- [x] I have not included unrelated changes in this PR
