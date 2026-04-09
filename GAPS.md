# GAPS

## Scope

Track remaining gaps after the wrapped-hyperlink strategy update and PR text alignment.

## Questions

1. Should we also add targeted regression coverage for wrapped markdown links in TUI tests now, or keep this PR minimal and rely on upstream test coverage plus manual validation?
2. Do we want to align this branch with any final adjustments that land in #20400 before merge review?
3. Should we explicitly codify a required wrap-link QA matrix in contributor docs for future hyperlink fixes?

## Unexpecteds

1. Disk-full fallout caused partial Bun package writes (observed zero-byte Babel package metadata during recovery), which required a full reinstall.
2. Full test run now executes, but one test remains environment-sensitive to file mode expectations under current `umask` (`test/tool/write.test.ts`: expected `0644`, observed `0640`).

## User Review Queue Refs

1. [URQ-1] Confirm PR body issue/PR references are sufficient: #14966, #18394, #20400, anomalyco/opentui#735, #736, #737.
2. [URQ-2] Decide whether to keep this PR scoped to the minimal `detectLinks` wiring or add regression tests in this branch.
3. [URQ-3] Confirm whether the environment-sensitive write-permission test should be handled in a follow-up (umask-aware assertion) outside this hyperlink PR.
4. [URQ-4] Confirm whether ghostty behavior references should be included in review notes as compatibility context rather than ownership of the fix.

## Related refs

- https://github.com/anomalyco/opencode/issues/14966
- https://github.com/anomalyco/opencode/issues/18394
- https://github.com/anomalyco/opencode/pull/20400
- https://github.com/anomalyco/opentui/issues/735
- https://github.com/anomalyco/opentui/pull/736
- https://github.com/anomalyco/opentui/pull/737
- https://github.com/ghostty-org/ghostty/discussions/2780
- https://github.com/ghostty-org/ghostty/issues/1197
- https://github.com/ghostty-org/ghostty/issues/2114
