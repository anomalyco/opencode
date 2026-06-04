# IPC Handler Registration Issues

> **Severity**: P1 - Feature completely broken

## Problem

You write an IPC handler, update types, update preload, but the frontend call fails:

```typescript
// Renderer
const result = await window.api.feature.doSomething();
// Error: No handler registered for 'feature:doSomething'
```

The code exists, TypeScript compiles, but nothing works at runtime.

## Symptoms

- New IPC handlers don't respond
- `ipcRenderer.invoke()` returns undefined or throws
- No errors during build
- Feature code exists but doesn't execute

## Root Cause

IPC handlers must be **explicitly registered** during app startup. Creating a file with handler code doesn't automatically register it.

### The Registration Chain

```
App startup
    |
    v
src/main/index.ts
    |
    v
setupAllIpcHandlers()  (in src/main/ipc/index.ts)
    |
    +--> setupAuthHandlers()
    +--> setupSyncHandlers()
    +--> setupEntityHandlers()
    +--> ... (each domain's setup function)
    |
    v
ipcMain.handle('channel:name', handlerFn)  <-- Registration happens here
```

If your handler isn't called in this chain, it never gets registered.

## Common Mistakes

### Mistake 1: Creating a New File Without Registering

```
src/main/ipc/
├── index.ts              # Calls setupAuthHandlers(), setupSyncHandlers()
├── auth.handler.ts       # setupAuthHandlers() defined here
├── sync.handler.ts       # setupSyncHandlers() defined here
└── feature.ts            # NEW FILE - setupFeatureHandlers() defined
                          # but NEVER called from index.ts!
```

**Fix**: Import and call your setup function in `index.ts`:

```typescript
// src/main/ipc/index.ts
import { setupFeatureHandlers } from './feature.handler';

export function setupAllIpcHandlers(): void {
  setupAuthHandlers();
  setupSyncHandlers();
  setupFeatureHandlers(); // Add this!
}
```

### Mistake 2: Adding to Wrong File

Project has `sync.handler.ts`, you create `sync.ts`:

```
src/main/ipc/
├── sync.handler.ts       # Existing, registered in index.ts
└── sync.ts               # New file, NOT registered
```

**Fix**: Add handlers to the existing file instead of creating a new one.

### Mistake 3: Wrong Naming Convention

Project uses `*.handler.ts`, you use `*.ts`:

```
src/main/ipc/
├── auth.handler.ts       # Follows convention
├── sync.handler.ts       # Follows convention
└── feature.ts            # Breaks convention - easy to miss
```

**Fix**: Follow the project's naming convention.

## Debugging Checklist

When IPC calls fail, verify each step:

1. **Channel name matches everywhere**

   ```typescript
   // channels.ts
   FEATURE: { DO_SOMETHING: 'feature:doSomething' }

   // handler
   ipcMain.handle(IPC_CHANNELS.FEATURE.DO_SOMETHING, ...)

   // preload
   doSomething: () => ipcRenderer.invoke('feature:doSomething')
   ```

2. **Handler is registered**

   ```typescript
   // Check index.ts calls your setup function
   grep "setupFeatureHandlers" src/main/ipc/index.ts
   ```

3. **Preload exposes the API**

   ```typescript
   // preload.ts
   contextBridge.exposeInMainWorld('api', {
     feature: {
       doSomething: () => ipcRenderer.invoke('feature:doSomething'),
     },
   });
   ```

4. **TypeScript types are correct**
   ```typescript
   // window.d.ts or similar
   interface Window {
     api: {
       feature: {
         doSomething: () => Promise<Result>;
       };
     };
   }
   ```

## Best Practice: File Organization

```
src/main/ipc/
├── index.ts              # Central registration point
├── auth.handler.ts       # All auth-related handlers
├── sync.handler.ts       # All sync-related handlers
├── entity.handler.ts     # All entity-related handlers
└── ...
```

**Principles**:

1. **One file per domain** - Group related handlers together
2. **Each file exports a setup function** - `setupXxxHandlers()`
3. **index.ts calls all setup functions** - Single place to verify registration
4. **Don't create duplicate domain files** - Extend existing file instead

## Quick Fix Tools

```bash
# Find existing handler files
find src/main/ipc -name "*.handler.ts"

# Check what's registered
grep "setup.*Handlers" src/main/ipc/index.ts

# Find channel definitions
grep -r "feature:" src/shared/constants/
```

## Key Insight

**File existence does not equal functionality in registration-based systems.**

This applies to:

- Electron IPC handlers
- Express/Hono route handlers
- Plugin systems
- Event listeners
- Any system that requires explicit registration

Always trace the registration chain from startup to your code.
