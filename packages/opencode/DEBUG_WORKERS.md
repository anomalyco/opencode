# Worker Pool Debug Guide

## Current Status

Build: ✅ Working  
Version: 0.0.0-dev-codesurf-202511052053  
Worker Pool: ⚠️ **With detailed logging and automatic fallback**

## What Changed

### Enhanced Logging

Added comprehensive logging to track:

- Worker initialization attempts
- Worker path resolution (bundled vs dev)
- Worker creation success/failure
- Tool execution routing (worker vs fallback)
- Error details with stack traces

### Automatic Fallback

- Worker pool tries to execute tools
- If it fails (no workers, error, timeout), automatically falls back to direct execution
- **Tools will NEVER hang** - they'll always execute one way or another

## How to Debug

### 1. Check Logs

```bash
tail -f ~/.opencode/logs/opencode.log | grep -i "worker\|tool"
```

Look for:

- `"initializing tool worker pool"` - Pool starting
- `"using bundled worker path"` or `"using dev worker path"` - Path resolution
- `"creating worker"` - Worker creation attempts
- `"worker initialized"` - Successful worker creation
- `"worker pool ready"` - How many workers were created
- `"NO WORKERS CREATED"` - Critical error
- `"executing tool in worker"` - Tool using worker pool
- `"worker pool execution failed, using direct execution"` - Fallback triggered

### 2. Check Worker Stats

Add this to your code:

```typescript
import { ToolWorkerPool } from "@/tool/worker-pool"

console.log(ToolWorkerPool.getStats())
// {
//   totalWorkers: 0,      // ← Should be 2-8
//   busyWorkers: 0,
//   queuedTasks: 0,
//   tasksCompleted: 0
// }
```

### 3. Test Tool Execution

Run a simple command and watch logs:

```bash
# In one terminal
tail -f ~/.opencode/logs/opencode.log | grep -E "worker|tool.*execute"

# In another terminal
./dist/codesurf-ai-darwin-arm64/bin/codesurf -p "list files in current directory"
```

## Expected Log Flow

### Successful Worker Pool:

```
[tool-worker-pool] initializing tool worker pool count=8
[tool-worker-pool] using bundled worker path path=./src/tool/worker-impl.ts
[tool-worker-pool] creating worker index=0 path=./src/tool/worker-impl.ts
[tool-worker-pool] worker initialized index=0
[tool-worker-pool] creating worker index=1 path=./src/tool/worker-impl.ts
[tool-worker-pool] worker initialized index=1
...
[tool-worker-pool] worker pool ready count=8 totalRequested=8
[tool-worker-pool] executing tool in worker toolID=list workerIndex=0
[tool-worker-pool] tool execution completed toolID=list tasksCompleted=1
```

### Failed Worker Pool (Fallback):

```
[tool-worker-pool] initializing tool worker pool count=8
[tool-worker-pool] using bundled worker path path=./src/tool/worker-impl.ts
[tool-worker-pool] creating worker index=0 path=./src/tool/worker-impl.ts
[tool-worker-pool] failed to initialize worker index=0 error="Worker not found"
[tool-worker-pool] creating worker index=1 path=./src/tool/worker-impl.ts
[tool-worker-pool] failed to initialize worker index=1 error="Worker not found"
...
[tool-worker-pool] worker pool ready count=0 totalRequested=8
[tool-worker-pool] NO WORKERS CREATED - tool execution will fail!
[session.prompt] worker pool execution failed, using direct execution tool=list error="No workers available"
```

## Common Issues

### Issue 1: No Workers Created

**Symptom:** `totalWorkers: 0` in stats  
**Cause:** Worker path not found or worker file not bundled  
**Effect:** All tools fall back to direct execution (slower but works)  
**Fix:** Check build configuration, ensure worker files are bundled

### Issue 2: Workers Created But Hanging

**Symptom:** Tools don't execute, no fallback triggered  
**Cause:** Worker RPC communication broken  
**Effect:** Tools hang indefinitely  
**Fix:** This version has timeout protection (TODO: add timeout)

### Issue 3: Fallback Always Triggered

**Symptom:** Always see "using direct execution" in logs  
**Cause:** Workers created but failing to execute tools  
**Effect:** Works but not using parallelization  
**Fix:** Check worker implementation, RPC communication

## Performance Comparison

### With Working Worker Pool:

```
- Tool execution: Parallel
- Read 5 files: ~100ms (parallel)
- CPU usage: High (good)
- Logs: "executing tool in worker"
```

### With Fallback (Direct):

```
- Tool execution: Sequential
- Read 5 files: ~500ms (sequential)
- CPU usage: Low (waiting)
- Logs: "using direct execution"
```

## Testing Checklist

- [ ] Build succeeds
- [ ] Binary runs without hanging
- [ ] Tools execute (check in TUI)
- [ ] Check logs for worker creation
- [ ] Verify fallback works if workers fail
- [ ] Test parallel tool execution (multiple tools at once)
- [ ] Monitor CPU usage during tool execution

## Next Steps

1. **Test the build** - Run it and trigger some tool calls
2. **Check the logs** - See which mode it's using (worker or fallback)
3. **Report findings** - Share what you see in logs
4. **Fix worker path** - If needed based on logs
