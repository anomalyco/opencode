## Finding from Rebase Attempt

I tried rebasing PR #15250 onto current dev but ran into extensive conflicts that need manual resolution:

### Conflicts Found (18 files):
- **Core backend**: `session.ts`, `index.ts` - API changes for archive/unarchive
- **i18n**: 14 language files - new keys added in different order

### Key Conflict Example (session.ts):
\`\`\`typescript
// Dev (HEAD):
if (updates.time?.archived !== undefined) {
  await Session.setArchived({ sessionID, time: updates.time.archived })
}

// Their version handles unarchive (archived: null):
if (updates.time !== undefined && "archived" in updates.time) {
  session = await Session.setArchived({ sessionID, time: updates.time.archived ?? undefined })
}
\`\`\`

### Recommendation:
This PR needs a careful manual rebase by a maintainer or contributor with time for the 18-file merge. The test failures in CI (transform.test.ts lines 1819, 1871) are PRE-EXISTING issues unrelated to this PR - they're failing because new providers were added to dev after this PR was made.

### Test Failure Investigation:
- Expected providers: subset
- Got extra: alibaba, copilot, openaiCompatible, openrouter
- These are NEW providers added to dev after PR creation
- NOT caused by archive feature changes

Thanks for the feature! Looking forward to this landing.