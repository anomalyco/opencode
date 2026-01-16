# Quickstart: MCP Connectors API Alignment Fixes

**Feature**: 006-fix-mcp-api-alignment
**Date**: 2026-01-15

## Overview

This guide provides step-by-step instructions for applying the API alignment fixes to the MCP Connectors implementation.

## Prerequisites

- Node.js 18+ and pnpm installed
- Repository cloned and on branch `006-fix-mcp-api-alignment`
- Tauri development environment set up

## Files to Modify

| File | Error Count | Categories |
|------|-------------|------------|
| `packages/app/src/context/mcp-connectors.tsx` | 19 | File I/O, Zod, Types |
| `packages/app/src/components/mcp-connector-form.tsx` | 12 | Dialog, Icons |
| `packages/app/src/components/mcp-connectors-section.tsx` | 18 | Dialog, Toast, Button, Icons |
| `packages/app/src/components/mcp-connector-item.tsx` | 3 | Icons |

## Fix Order

Apply fixes in this order to minimize cascading issues:

### Phase 1: Critical (Enables Compilation)

#### 1.1 File I/O (mcp-connectors.tsx)

```typescript
// Add import at top
import { writeTextFile } from '@tauri-apps/api/fs'

// Find and replace (2 locations):
// BEFORE:
await sdk.client.file.write({ path: MCP_JSON_PATH, content })
// AFTER:
await writeTextFile(MCP_JSON_PATH, content)
```

#### 1.2 Dialog API (mcp-connector-form.tsx, mcp-connectors-section.tsx)

See `contracts/dialog-api.md` for detailed patterns.

**Key changes:**
- Add `import { useDialog } from '@opencode-ai/ui/context/dialog'`
- Replace compound Dialog pattern with useDialog() hook
- Move buttons from Dialog.Footer to manual flex container

#### 1.3 Icon Names (all component files)

```typescript
// Replace throughout:
icon="edit"          → icon="pencil-line"
icon="trash"         → icon="close"
icon="spinner"       → icon="circle-check" class="animate-spin"
icon="alert-triangle" → icon="circle-error"
```

**For IconButton size:**
```typescript
// Remove size="small", use default or iconSize instead:
<IconButton icon="close" size="small" />  →  <IconButton icon="close" />
```

### Phase 2: Full Functionality

#### 2.1 Toast API (mcp-connectors-section.tsx)

```typescript
// BEFORE:
showToast("Message", "success")
// AFTER:
showToast({ title: "Message", variant: "success" })

// BEFORE:
showToast(error.message, "error")
// AFTER:
showToast({ title: "Error", description: error.message, variant: "error" })
```

#### 2.2 Zod Error Handling (mcp-connectors.tsx)

```typescript
// BEFORE (4 locations):
error.errors.map((e) => ...)
// AFTER:
error.issues.map((e) => ...)
```

#### 2.3 Button Variants (mcp-connectors-section.tsx)

```typescript
// BEFORE:
<Button variant="destructive">Remove</Button>
// AFTER:
<Button variant="primary">Remove</Button>
```

#### 2.4 Type Safety (mcp-connectors.tsx)

```typescript
// Line ~141 - JSON parse:
// BEFORE:
const config = JSON.parse(result) as McpConfig
// AFTER:
const config = JSON.parse(result.data.content) as McpConfig

// Return types - remove data from void returns:
// BEFORE:
return { success: true, data: config }
// AFTER:
return { success: true }
```

## Verification

### Step 1: Type Check
```bash
cd packages/app
pnpm typecheck
```
Expected: 0 errors

### Step 2: Build
```bash
pnpm build
```
Expected: Build succeeds

### Step 3: Development Mode
```bash
pnpm dev
```
Expected: App launches without errors

### Step 4: Functional Test
1. Navigate to settings/connectors section
2. View existing connectors (if any)
3. Add a new connector
4. Edit an existing connector
5. Remove a connector with confirmation
6. Verify changes persist after app restart

## Common Issues

### Issue: Import not found for useDialog
**Solution**: Check import path is `@opencode-ai/ui/context/dialog`

### Issue: Icon not rendering
**Solution**: Verify icon name exists in `packages/ui/src/components/icon.tsx`

### Issue: Dialog not appearing
**Solution**: Ensure using `dialog.show(() => <Content />)` pattern

### Issue: Toast not showing variant color
**Solution**: Use `variant` property, not `type`

## Rollback

If issues arise, revert to the original implementation:
```bash
git checkout 004-mcp-connectors -- packages/app/src/components/mcp-*.tsx
git checkout 004-mcp-connectors -- packages/app/src/context/mcp-connectors.tsx
```

## Success Criteria

- [ ] 0 TypeScript errors (`pnpm typecheck`)
- [ ] Successful build (`pnpm build`)
- [ ] App launches without console errors
- [ ] All CRUD operations work on connectors
- [ ] Changes persist to `.mcp.json` file
