# Fix Desktop Skills Panel Showing Empty

## Problem Statement

The desktop version's skills panel (opened with `cmd+shift+;`) displays "0 loaded" and "No skills loaded", even though:
- Skills exist in `~/.claude/skills/` (5 skills confirmed)
- Skills exist in project directories like `~/pyope/.agents/skills/` (14+ skills)
- CLI `/skills` command correctly shows all skills
- Skill files are properly formatted with valid SKILL.md frontmatter

## Root Cause Analysis

### Issue 1: QuickAssistant Mode Bug
**Location**: `packages/opencode/src/skill/index.ts:129-132`

**Problem**: The original code skips ALL skill loading (including global skills) when in QuickAssistant mode:

```typescript
const load = async () => {
  if (QuickAssistant.active(directory)) {
    log.info("skip quick assistant skills", { directory })
    return  // ❌ Exits immediately, skipping global skills!
  }

  // Global skills loading code never reached...
}
```

**Impact**: Any directory that triggers QuickAssistant mode will have zero skills loaded.

### Issue 2: API Not Returning Data
**Symptom**:
- `curl http://127.0.0.1:<port>/api/v2/command` returns no data
- Server logs show no skill loading debug messages
- Skills panel receives empty array from backend

**Possible Causes**:
1. Code changes not being compiled/deployed correctly
2. Skills loading happens lazily and hasn't been triggered
3. API endpoint filtering out skills for some reason

### Issue 3: Build/Deployment Pipeline
**Symptom**: Added debug logs (`log.warn("[SKILL DEBUG]...")`) don't appear in server logs

**Implication**: Code modifications are not being reflected in the running server, suggesting:
- Build cache issues
- Incorrect build process
- Server using old compiled code

## Completed Work

### Code Fix Applied
**File**: `packages/opencode/src/skill/index.ts`
**Lines**: 128-163

**Changes**:
1. Moved global skills loading BEFORE QuickAssistant check
2. Changed QuickAssistant check to only skip project-level skills
3. Added comprehensive debug logging

**New Logic**:
```typescript
const load = async () => {
  // ✅ Always load global skills first
  if (!Flag.OPENCODE_DISABLE_EXTERNAL_SKILLS) {
    for (const dir of EXTERNAL_DIRS) {  // [".claude", ".agents"]
      const root = path.join(Global.Path.home, dir)
      await scan(state, root, EXTERNAL_SKILL_PATTERN, { dot: true, scope: "global" })
    }
  }

  // ✅ Only skip project-level skills in QuickAssistant mode
  if (QuickAssistant.active(directory)) {
    log.warn("skip quick assistant project skills", { directory })
    return
  }

  // Load project-level skills...
}
```

## Verification Steps Taken

1. ✅ Confirmed skill files exist and are valid
2. ✅ Verified skill file format (YAML frontmatter with name/description)
3. ✅ Checked global skills directory: `~/.claude/skills/` (5 skills)
4. ✅ Checked project skills directory: `~/pyope/.agents/skills/` (14 skills)
5. ✅ Tested CLI command: `/skills` works correctly
6. ❌ API endpoint returns no data
7. ❌ Debug logs not appearing in server output
8. ❌ Skills panel still shows empty

## Environment Details

- **Platform**: macOS (Darwin 24.0.0)
- **Desktop Version**: 1.3.9-dev
- **Build Mode**: Development (`npm run dev:desktop`)
- **Server Port**: Varies (64057, 65305, 51616 observed)
- **Global Skills Path**: `~/.claude/skills/`
- **Project Skills Path**: `<project>/.claude/skills/` or `<project>/.agents/skills/`

## Remaining Work

### High Priority
1. **Verify Build Process**
   - Ensure `packages/opencode/dist` is being rebuilt
   - Confirm sidecar binary includes latest code
   - Check if hot-reload is working for TypeScript changes

2. **Debug API Layer**
   - Add logging to command list endpoint
   - Verify skills are loaded into memory
   - Check if frontend is calling correct API endpoint

3. **Test Fix Deployment**
   - Clean build: `rm -rf packages/opencode/dist`
   - Full rebuild: `npm run dev:desktop`
   - Verify debug logs appear
   - Confirm API returns skills

### Medium Priority
4. **Add Integration Test**
   - Test that global skills load in all modes
   - Test that project skills load only in correct project
   - Test QuickAssistant mode doesn't break global skills

5. **Document Skill Loading**
   - Document the skill discovery paths
   - Clarify global vs project-level skills
   - Add troubleshooting guide

## Expected Behavior After Fix

### Global Skills (`~/.claude/skills/`)
- ✅ Should load in ALL projects
- ✅ Should load in QuickAssistant mode
- ✅ Should appear in skills panel everywhere

### Project Skills (`<project>/.claude/skills/` or `.agents/skills/`)
- ✅ Should load only when in that specific project
- ❌ Should NOT load in QuickAssistant mode
- ✅ Should appear in skills panel for that project

### Skills Panel (`cmd+shift+;`)
- ✅ Should show count of loaded skills
- ✅ Should list all available skills with descriptions
- ✅ Should allow searching/filtering skills
- ✅ Should insert skill command when selected

## Testing Checklist

- [ ] Global skills appear in skills panel (any project)
- [ ] Project skills appear only in their project
- [ ] Skills panel shows correct count
- [ ] CLI `/skills` and panel show same skills
- [ ] QuickAssistant mode shows global skills
- [ ] API endpoint returns skill data
- [ ] Debug logs appear in server output

## Files Modified

1. `packages/opencode/src/skill/index.ts` (lines 128-163)
   - Reordered skill loading logic
   - Added debug logging
   - Fixed QuickAssistant mode behavior

## Related Issues

- Skills panel empty despite skills existing
- QuickAssistant mode breaking skill loading
- Global skills not loading consistently

## Notes

- The fix is correct in principle but needs proper build/deployment
- CLI works correctly, suggesting backend logic is sound
- Issue is likely in build pipeline or API layer
- User has 5 global skills + 14 project skills that should be visible
