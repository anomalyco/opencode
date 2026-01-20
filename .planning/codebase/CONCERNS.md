# Codebase Concerns

**Analysis Date:** 2026-01-19

## Tech Debt

**Extensive `any` Type Usage:**
- Issue: Heavy use of `any` types bypasses TypeScript's type safety, especially in provider integrations
- Files: `packages/opencode/src/provider/provider.ts` (lines 44, 65, 69, 113, 122, 134, 146, 160, 228, 346, 363, 386, 454), `packages/opencode/src/lsp/server.ts` (lines 646, 681, 1432), `packages/opencode/src/lsp/index.ts` (lines 365-366, 438, 451), `packages/opencode/src/bus/index.ts` (lines 9, 20, 85, 89)
- Impact: Runtime type errors may slip through; harder to refactor safely
- Fix approach: Define proper interfaces for provider SDKs, LSP responses, and bus events; gradually replace `any` with typed alternatives

**Empty Catch Blocks Swallowing Errors:**
- Issue: 19+ instances of empty `catch {}` blocks that silently swallow exceptions
- Files: `packages/opencode/src/session/retry.ts:85`, `packages/opencode/src/session/message-v2.ts:679`, `packages/opencode/src/config/config.ts:1204`, `packages/opencode/src/pty/index.ts:79,175`, `packages/opencode/src/plugin/copilot.ts:81`, `packages/opencode/src/server/mdns.ts:39`, `packages/opencode/src/global/index.ts:53`, `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:906`, `packages/app/src/utils/speech.ts:219,247,264,278,291`, `packages/ui/src/theme/context.tsx:41,65`
- Impact: Silent failures make debugging difficult; may hide critical issues
- Fix approach: Log errors at minimum; consider whether each case truly needs suppression

**`@ts-ignore` and `@ts-expect-error` Comments:**
- Issue: 15+ type overrides indicating type system gaps or workarounds
- Files: `packages/opencode/src/session/prompt.ts:48`, `packages/opencode/src/session/index.ts:436`, `packages/opencode/src/session/llm.ts:245`, `packages/opencode/src/provider/provider.ts:65,710,716,1022`, `packages/opencode/src/plugin/index.ts:26,107,123`, `packages/opencode/src/server/server.ts:44`, `packages/opencode/src/server/routes/tui.ts:270`, `packages/opencode/src/file/watcher.ts:9`
- Impact: Suppressed type errors may hide real bugs
- Fix approach: Properly type the underlying APIs; document why suppression is needed if unavoidable

**Deprecated API Usage:**
- Issue: Multiple deprecated fields still in active use (mode, tools, maxSteps, autoShare, layout)
- Files: `packages/opencode/src/config/config.ts:137,554,574,899,933,1019`, `packages/opencode/src/session/prompt.ts:99`, `packages/opencode/src/session/status.ts:35,67`
- Impact: Technical debt accumulates; migration path unclear to users
- Fix approach: Create migration tool; add deprecation warnings at runtime; set removal deadline

**Forked/Vendored SDK Code:**
- Issue: OpenAI-compatible SDK appears forked and maintained internally
- Files: `packages/opencode/src/provider/sdk/openai-compatible/` directory (1713 lines in main file)
- Impact: Must manually port upstream fixes; divergence risk
- Fix approach: Evaluate if custom fork is still needed; document differences from upstream

## Known Bugs

**Symlink Path Traversal Vulnerability (Documented):**
- Symptoms: Symlinks inside project can potentially escape sandbox restrictions
- Files: `packages/opencode/src/file/index.ts:280-281,340-341`
- Trigger: Create symlink inside project pointing to sensitive file outside project
- Workaround: Current `Filesystem.contains` check is lexical only; tests exist but don't cover symlink case

**Windows Cross-Drive Path Check Bypass:**
- Symptoms: Paths on different drives may bypass directory containment checks on Windows
- Files: `packages/opencode/src/file/index.ts:281,341`
- Trigger: Reference files on different drive letters
- Workaround: None documented; marked as TODO

## Security Considerations

**Path Traversal Protection:**
- Risk: Despite lexical checks, symlinks and Windows edge cases may allow file access outside project
- Files: `packages/opencode/src/file/index.ts`, `packages/opencode/src/util/filesystem.ts`
- Current mitigation: `Filesystem.contains()` lexical check, `Instance.containsPath()`, test coverage in `packages/opencode/test/file/path-traversal.test.ts`
- Recommendations: Implement `realpath` canonicalization before containment checks; add symlink-specific tests

**Command Execution in Bash Tool:**
- Risk: Arbitrary shell command execution with permission checks that could potentially be bypassed
- Files: `packages/opencode/src/tool/bash.ts`
- Current mitigation: Tree-sitter parsing of commands, permission checks for external directories, command pattern matching
- Recommendations: Audit command parsing for edge cases; consider sandboxing options

**Remote Config Loading:**
- Risk: Remote config from `.well-known/opencode` could inject malicious configuration
- Files: `packages/opencode/src/config/config.ts:45-62`
- Current mitigation: HTTPS-only URLs
- Recommendations: Validate remote config schema strictly; add integrity checks; warn users about remote config sources

**API Key Handling:**
- Risk: API keys passed through environment and provider options
- Files: `packages/opencode/src/provider/provider.ts:987` (custom fetch with proxy support)
- Current mitigation: Keys stored in Auth system, not logged
- Recommendations: Audit logging to ensure keys never appear in logs or error messages

## Performance Bottlenecks

**Large File Handling:**
- Problem: Several core files exceed 1500+ lines, increasing cognitive load and potentially compile times
- Files: `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (2050 lines), `packages/opencode/src/lsp/server.ts` (2046 lines), `packages/opencode/src/session/prompt.ts` (1795 lines), `packages/opencode/src/provider/sdk/openai-compatible/src/responses/openai-responses-language-model.ts` (1713 lines), `packages/opencode/src/cli/cmd/github.ts` (1548 lines)
- Cause: Accumulated functionality without module extraction
- Improvement path: Extract logical components; split route handlers; separate provider-specific logic

**Glob/File Scanning:**
- Problem: File scanning with `Bun.Glob` used extensively with potential for large directory trees
- Files: `packages/opencode/src/file/index.ts`, `packages/opencode/src/util/filesystem.ts:68-92`
- Cause: Recursive scanning without limits in some code paths
- Improvement path: Add depth limits; implement streaming for large results; cache results where appropriate

## Fragile Areas

**Session/Prompt System:**
- Files: `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/processor.ts`, `packages/opencode/src/session/index.ts`
- Why fragile: Complex state management across multiple async operations; retry logic; compaction logic
- Safe modification: Extensive test coverage needed before changes; test with various provider error scenarios
- Test coverage: Some tests exist in `packages/opencode/test/session/` but complex state transitions may be undertested

**Provider Integration Layer:**
- Files: `packages/opencode/src/provider/provider.ts` (1220 lines), `packages/opencode/src/provider/transform.ts`
- Why fragile: Many provider-specific code paths with `any` types; custom model loaders for each provider
- Safe modification: Test against each provider; mock provider responses carefully
- Test coverage: `packages/opencode/test/provider/` exists but may not cover all provider edge cases

**LSP Server Management:**
- Files: `packages/opencode/src/lsp/server.ts` (2046 lines), `packages/opencode/src/lsp/index.ts`
- Why fragile: Complex lifecycle management; downloads/installs external binaries; platform-specific logic
- Safe modification: Test on multiple platforms; handle download failures gracefully
- Test coverage: Minimal test coverage observed in `packages/opencode/test/lsp/`

## Scaling Limits

**In-Memory State Management:**
- Current capacity: All session state held in memory via `Instance.state()`
- Limit: May hit memory limits with many concurrent sessions or very long conversations
- Scaling path: Consider persistence layer for large session histories; implement streaming for message replay

**GitHub API Rate Limits:**
- Current capacity: Uses unauthenticated GitHub API calls for LSP server downloads
- Limit: 60 requests/hour for unauthenticated requests
- Scaling path: Add authentication support for GitHub API; cache downloaded binaries

## Dependencies at Risk

**Bun Runtime Dependency:**
- Risk: Heavy reliance on Bun-specific APIs (`$` shell, `Bun.file`, `Bun.Glob`)
- Impact: Locked to Bun runtime; cannot easily migrate to Node.js if needed
- Migration plan: Abstract Bun-specific APIs behind interfaces if portability becomes needed

**AI SDK Dependency:**
- Risk: Using `ai` package version 5.0.119 with custom patches
- Impact: Breaking changes in AI SDK could require significant migration work
- Migration plan: Document custom integrations; monitor SDK changelog; consider abstracting SDK usage

**@solidjs/start Preview Package:**
- Risk: Using preview/dev version of SolidStart: `https://pkg.pr.new/@solidjs/start@dfb2020`
- Files: `package.json:58`
- Impact: Unstable dependency; may break unexpectedly
- Migration plan: Update to stable release when available

## Missing Critical Features

**Permission Rule Persistence:**
- Problem: Permission rules not saved to disk yet
- Files: `packages/opencode/src/permission/next.ts:212-214` - "TODO: we don't save the permission ruleset to disk yet until there's UI to manage it"
- Blocks: Users must re-approve permissions each session

**Error Display in Connect Dialog:**
- Problem: TODO comment indicates errors not shown to users
- Files: `packages/opencode/src/app/src/components/dialog-connect-provider.tsx:354` - "// TODO: show error"
- Blocks: Users may not understand why provider connection fails

## Test Coverage Gaps

**Test File Ratio:**
- What's not tested: ~246 source files with only ~52 test files (~21% file coverage)
- Files: `packages/opencode/src/` vs `packages/opencode/test/`
- Risk: Many code paths untested; regressions may go unnoticed
- Priority: High

**Untested Areas (by observation):**
- `packages/opencode/src/share/` - No test directory observed
- `packages/opencode/src/acp/` - Only 1 test file for agent.ts
- `packages/opencode/src/cli/cmd/` - Limited coverage for CLI commands
- `packages/opencode/src/worktree/` - No tests observed
- Priority: Medium-High

**Integration Testing:**
- What's not tested: End-to-end flows with real providers
- Files: Most tests appear to be unit tests
- Risk: Integration issues may not surface until production
- Priority: Medium

---

*Concerns audit: 2026-01-19*
