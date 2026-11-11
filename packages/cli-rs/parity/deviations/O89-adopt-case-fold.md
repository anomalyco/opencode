# O89: the adopted subpath under a Windows root that case folding lengthens

**TypeScript.** `Worktree.adopt` compares a session directory with the repository root lowercased on a Windows
drive, then takes the subpath as `directory.slice(root.length + 1)` (`packages/schema/src/worktree.ts:105-108`).
That counts UTF-16 units of the unlowered root, which no longer line up with the directory when lowercasing
changed a length. For `adopt(C:\İ\ä, root c:\i̇)` it gives the subpath `""` (checked with bun).

**Rust.** `projects::adopt` takes the directory's path segments after the root's segments, so the example gives
`"ä"`. Every other input gives the same subpath as TypeScript.

**Reason.** The user's decision O-89: fix in Rust the defects TS shares, and record them as deviations.
