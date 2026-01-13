# Sandbox Module

The sandbox module provides isolated execution environments for OpenCode sessions. It abstracts away the details of where code runs, allowing seamless switching between local git worktrees and remote cloud sandboxes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Tool Layer                               │
│   (read, write, edit, bash, glob, grep, etc.)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SandboxRuntime                              │
│   - withSession(sessionId, fn)                                  │
│   - readFile / writeFile / exists / stat / readdir              │
│   - exec(command, args)                                         │
│   - isRemote()                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ LocalProvider   │  │ ModalProvider   │  │ K8sProvider     │
│ (git worktrees) │  │ (Modal.com VMs) │  │ (K8s pods)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Providers

### Local Provider (default)
Uses git worktrees to create isolated directories for each session. Runs on the local machine.

### Modal Provider
Uses Modal.com cloud VMs. Requires `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` environment variables.

### Kubernetes Provider
Uses Kubernetes pods. Requires a valid kubeconfig and cluster access.

## Configuration

Add to your `opencode.json`:

```json
{
  "sandbox": {
    "provider": "local",
    "modal": {
      "appName": "opencode-sandbox",
      "image": "python:3.11-slim",
      "timeout": 3600
    },
    "kubernetes": {
      "namespace": "opencode",
      "image": "ubuntu:22.04"
    }
  }
}
```

## Usage in Tools

Tools should use `SandboxRuntime` for all file and exec operations:

```typescript
import { SandboxRuntime } from "@/sandbox/runtime"

// Wrap tool execution in session context
await SandboxRuntime.withSession(sessionId, async () => {
  // These automatically route to local or remote
  const content = await SandboxRuntime.readFile("/path/to/file")
  await SandboxRuntime.writeFile("/path/to/file", "content")
  
  const result = await SandboxRuntime.exec("npm", ["test"])
  
  // Check if running remotely
  if (SandboxRuntime.isRemote()) {
    // Remote-specific logic
  }
})
```

## Files

- `provider.ts` - Core types, interfaces, and provider registry
- `runtime.ts` - Session-aware file/exec operations (main API for tools)
- `context.ts` - Session-to-sandbox lifecycle management
- `local.ts` - Git worktree-based local provider
- `modal.ts` - Modal.com cloud provider
- `kubernetes.ts` - Kubernetes pod provider
- `fs.ts` - Filesystem abstraction layer
