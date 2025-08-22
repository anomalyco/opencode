# OpenCode TUI Power Optimization & Responsiveness Fixes - Task List

## Phase 0: CRITICAL STABILITY FIXES (Days 1-2) 🚨

### 0.1 Fix Threading and Responsiveness Issues

- [ ] **Implement non-blocking API operations**

  - [ ] Move all `Client.Session.Chat()` calls to background goroutines
  - [ ] Move all `Client.Session.Shell()` calls to background goroutines
  - [ ] Add proper context cancellation for long-running operations
  - [ ] Implement request queuing to prevent UI blocking

- [ ] **Fix clipboard operations that cause crashes**

  - [ ] Add panic recovery around clipboard operations in `editor.go:517-540`
  - [ ] Implement safer image paste handling with error boundaries
  - [ ] Add clipboard operation timeout (2-3 seconds max)
  - [ ] Create fallback text-only paste when image paste fails

- [ ] **Implement proper input handling during AI response**

  - [ ] Allow text input while AI is writing (queue inputs)
  - [ ] Add input buffer to store keystrokes during blocking operations
  - [ ] Implement non-blocking text area updates
  - [ ] Add visual indicator when AI is processing vs ready for input

- [ ] **Add comprehensive error handling and recovery**
  - [ ] Wrap all Update() methods with panic recovery
  - [ ] Add graceful degradation for network failures
  - [ ] Implement automatic retry for failed operations
  - [ ] Add error state management to prevent cascading failures

**Files to modify:**

- `internal/tui/tui.go` (main Update loop - lines 128-141, 775-789)
- `internal/components/chat/editor.go` (clipboard operations - lines 517-540)
- `internal/app/app.go` (SendPrompt/SendShell methods - lines 759-820)
- `internal/components/chat/messages.go` (message handling)

**New files to create:**

- `internal/util/panic_recovery.go`
- `internal/util/input_buffer.go`
- `internal/util/safe_operations.go`

### 0.2 Fix Resource Management and Context Issues

- [ ] **Replace all context.Background() with proper contexts**

  - [ ] Add timeout contexts for all API calls (30-second max)
  - [ ] Replace `context.TODO()` in clipboard.go:50 with proper context
  - [ ] Implement context cancellation for user-initiated operations
  - [ ] Add context propagation through all async operations

- [ ] **Fix file watcher and goroutine leaks**

  - [ ] Proper cleanup of file watcher in `status.go:241-273`
  - [ ] Add missing channel close operations in status component
  - [ ] Fix infinite loop in `watchForGitChanges()` that can't be stopped
  - [ ] Implement proper cleanup in component destructors

- [ ] **Add bounds checking and nil pointer guards**

  - [ ] Check array bounds before slice operations
  - [ ] Add nil checks for all pointer dereferences
  - [ ] Validate message indices in `messages.go` before accessing
  - [ ] Add bounds checking for terminal dimensions

- [ ] **Fix unsafe memory operations**
  - [ ] Review unsafe.Pointer usage in `clipboard_windows.go:28,51-95`
  - [ ] Add proper error handling for Windows API calls
  - [ ] Implement safer buffer management for clipboard operations
  - [ ] Add memory bounds validation

**Files to modify:**

- All files using `context.Background()` (38 instances found)
- `internal/components/status/status.go` (watcher cleanup)
- `internal/clipboard/clipboard_windows.go` (unsafe operations)
- `internal/components/chat/messages.go` (bounds checking)

**New files to create:**

- `internal/util/context_manager.go`
- `internal/util/safe_memory.go`
- `internal/util/bounds_checker.go`

### 0.3 Fix Hidden Crash Conditions

- [ ] **Address TODOs that indicate incomplete error handling**

  - [ ] Fix `TODO: handle tool parts` in `messages.go:1137,1210`
  - [ ] Complete session compaction blocking in `tui.go:1188`
  - [ ] Address `FIXME: return fg or bg?` in `overlay.go:81`
  - [ ] Fix table rendering issue in `markdown.go:288`

- [ ] **Fix debug code left in production**

  - [ ] Remove `println()` statements in clipboard.go:43,53
  - [ ] Clean up debug logging that could impact performance
  - [ ] Remove test-only code paths that could cause issues

- [ ] **Add missing error propagation**
  - [ ] Ensure all API errors are properly surfaced to UI
  - [ ] Add error recovery for file operations
  - [ ] Implement fallback behaviors for network failures
  - [ ] Add user-friendly error messages

**Files to modify:**

- `internal/components/chat/messages.go` (tool parts handling)
- `internal/tui/tui.go` (session compaction)
- `internal/layout/overlay.go` (color handling)
- `internal/styles/markdown.go` (table rendering)
- `internal/clipboard/clipboard.go` (debug output)

### 0.4 Implement Proper Concurrency Architecture

- [ ] **Create thread-safe state management**

  - [ ] Add mutex protection for shared app state
  - [ ] Implement atomic operations for counters and flags
  - [ ] Create safe message queue for cross-goroutine communication
  - [ ] Add state synchronization mechanisms

- [ ] **Fix goroutine lifecycle management**

  - [ ] Add proper context cancellation for all background operations
  - [ ] Implement graceful shutdown for all workers
  - [ ] Add goroutine leak detection and prevention
  - [ ] Create centralized goroutine registry

- [ ] **Implement input/output separation**
  - [ ] Separate input handling from output rendering
  - [ ] Create dedicated goroutine for network operations
  - [ ] Implement background processing queue
  - [ ] Add proper synchronization between UI and background tasks

**Files to modify:**

- `internal/app/app.go` (state management)
- `internal/tui/tui.go` (concurrency model)
- `internal/util/concurrency.go` (worker management)

**New files to create:**

- `internal/util/thread_safe_state.go`
- `internal/util/goroutine_manager.go`
- `internal/util/message_queue.go`

## Phase 1: Critical Optimizations (Week 1)

### 1.1 Adaptive Animation System

- [ ] **Implement idle detection mechanism**

  - [ ] Add `lastActivity` timestamp to `messagesComponent` struct
  - [ ] Create `shouldAnimate()` method with configurable idle threshold
  - [ ] Add activity tracking to all user input events
  - [ ] Define animation states: `ACTIVE`, `IDLE`, `STOPPED`

- [ ] **Refactor shimmer animation logic**

  - [ ] Replace fixed 90ms interval with adaptive timing
  - [ ] Implement slow animation mode (500ms) for idle state
  - [ ] Add animation pause after 5 seconds of inactivity
  - [ ] Create `animationStateManager` component

- [ ] **Add animation configuration**
  - [ ] Define constants for animation intervals
  - [ ] Make idle threshold configurable via config
  - [ ] Add debug logging for animation state changes

**Files to modify:**

- `internal/components/chat/messages.go`
- `internal/components/chat/cache.go` (if animation affects caching)

### 1.2 API Call Debouncing

- [ ] **Create APIDebouncer component**

  - [ ] Implement generic debouncer with configurable delay
  - [ ] Add LRU cache for recent API responses
  - [ ] Include request deduplication logic
  - [ ] Add cache TTL management

- [ ] **Apply debouncing to completion providers**

  - [ ] Debounce file completion requests (300ms delay)
  - [ ] Debounce symbol completion requests (300ms delay)
  - [ ] Debounce agent completion requests (500ms delay)
  - [ ] Add cache invalidation on directory changes

- [ ] **Optimize session-related API calls**
  - [ ] Cache session objects with 30-second TTL
  - [ ] Batch session children requests
  - [ ] Implement incremental message loading

**Files to modify:**

- `internal/completions/files.go`
- `internal/completions/symbols.go`
- `internal/completions/agents.go`
- `internal/app/app.go` (session management)

**New files to create:**

- `internal/util/debouncer.go`
- `internal/util/api_cache.go`

## Phase 2: High Impact Optimizations (Weeks 2-3)

### 2.1 Centralized Timer Management

- [ ] **Create CentralTimerManager**

  - [ ] Implement single ticker for all timed operations
  - [ ] Add timer registration/deregistration system
  - [ ] Create callback-based expiration handling
  - [ ] Add proper cleanup on shutdown

- [ ] **Refactor toast timer system**

  - [ ] Replace individual `tea.Tick` calls with central manager
  - [ ] Implement batch toast expiration checking
  - [ ] Add toast priority system for resource management
  - [ ] Optimize toast rendering overlay

- [ ] **Optimize debounce timers**
  - [ ] Integrate debounce timers with central manager
  - [ ] Add timer coalescing for similar operations
  - [ ] Implement timer pooling to reduce allocations

**Files to modify:**

- `internal/components/toast/toast.go`
- `internal/tui/tui.go` (timer integration)

**New files to create:**

- `internal/util/timer_manager.go`
- `internal/components/toast/timer_manager.go`

### 2.2 Advanced Input/Output Architecture

- [ ] **Implement asynchronous rendering pipeline**

  - [ ] Create separate goroutine for rendering operations
  - [ ] Implement render queue with priority levels
  - [ ] Add frame rate limiting (30-60 FPS max)
  - [ ] Create render batching for multiple updates

- [ ] **Optimize text area performance**

  - [ ] Implement virtual scrolling for large text
  - [ ] Add incremental text updates instead of full redraws
  - [ ] Create text buffer pooling
  - [ ] Optimize cursor positioning calculations

- [ ] **Create responsive input system**
  - [ ] Implement input prediction for better responsiveness
  - [ ] Add input echo before server confirmation
  - [ ] Create optimistic UI updates
  - [ ] Implement input rollback on errors

**Files to modify:**

- `internal/components/chat/editor.go`
- `internal/components/textarea/textarea.go`
- `internal/tui/tui.go`

**New files to create:**

- `internal/util/render_pipeline.go`
- `internal/util/input_prediction.go`
- `internal/util/optimistic_updates.go`

### 2.4 View Rendering Cache

- [ ] **Implement view state hashing**

  - [ ] Create state hash function for components
  - [ ] Add dirty region tracking
  - [ ] Implement component-level change detection
  - [ ] Add hash-based cache validation

- [ ] **Create ViewCache system**

  - [ ] Cache rendered view strings by state hash
  - [ ] Implement partial view updates
  - [ ] Add cache size limits and LRU eviction
  - [ ] Create cache hit/miss metrics

- [ ] **Optimize lipgloss operations**
  - [ ] Cache expensive style calculations
  - [ ] Minimize style object creation
  - [ ] Implement style pooling for frequent operations
  - [ ] Profile and optimize hot rendering paths

**Files to modify:**

- `internal/tui/tui.go` (main view methods)
- `internal/components/chat/messages.go`
- `internal/components/chat/editor.go`
- `internal/components/status/status.go`

**New files to create:**

- `internal/util/view_cache.go`
- `internal/util/state_hash.go`

### 2.5 Efficient Network Request Handling

- [ ] **Implement request batching**

  - [ ] Create RequestBatcher for similar API calls
  - [ ] Add request coalescing for duplicate calls
  - [ ] Implement background request processing
  - [ ] Add request priority queuing

- [ ] **Optimize session state management**

  - [ ] Implement differential session updates
  - [ ] Add WebSocket connection for real-time updates
  - [ ] Create session state reconciliation logic
  - [ ] Add offline operation support

- [ ] **Add network request metrics**
  - [ ] Track API call frequency and timing
  - [ ] Monitor cache hit rates
  - [ ] Add network usage statistics
  - [ ] Create performance dashboards

**Files to modify:**

- `internal/api/api.go`
- `internal/app/app.go`

**New files to create:**

- `internal/util/request_batcher.go`
- `internal/util/network_metrics.go`

## Phase 3: Advanced Optimizations (Weeks 4-6)

### 3.1 Goroutine Pool Implementation

- [ ] **Create WorkerPool system**

  - [ ] Implement bounded worker pool with configurable size
  - [ ] Add job queuing with priority support
  - [ ] Create graceful shutdown handling
  - [ ] Add worker pool metrics and monitoring

- [ ] **Replace unbounded goroutine creation**

  - [ ] Refactor `mapParallel` to use worker pool
  - [ ] Update completion providers to use pooled workers
  - [ ] Optimize API logger goroutine management
  - [ ] Add goroutine leak detection

- [ ] **Implement resource limiting**
  - [ ] Add CPU usage monitoring
  - [ ] Implement backpressure for high-load scenarios
  - [ ] Create adaptive worker pool sizing
  - [ ] Add resource usage alerts

**Files to modify:**

- `internal/util/concurrency.go`
- `internal/util/apilogger.go`
- `internal/completions/*.go` (all completion providers)

**New files to create:**

- `internal/util/worker_pool.go`
- `internal/util/resource_monitor.go`

### 3.2 Memory Management Optimization

- [ ] **Implement LRU caching for message parts**

  - [ ] Create configurable cache size limits
  - [ ] Add memory usage monitoring
  - [ ] Implement cache eviction strategies
  - [ ] Add cache statistics and metrics

- [ ] **Optimize string and buffer management**

  - [ ] Implement string builder pooling
  - [ ] Add buffer reuse for rendering operations
  - [ ] Optimize memory allocations in hot paths
  - [ ] Create memory profiling tools

- [ ] **Add session data cleanup**
  - [ ] Implement automatic cleanup of old sessions
  - [ ] Add configurable data retention policies
  - [ ] Create garbage collection for unused data
  - [ ] Add storage usage monitoring

**Files to modify:**

- `internal/components/chat/cache.go`
- `internal/components/chat/messages.go`
- `internal/app/app.go`

**New files to create:**

- `internal/util/lru_cache.go`
- `internal/util/memory_manager.go`
- `internal/util/buffer_pool.go`

### 3.3 Power Consumption Monitoring

- [ ] **Create PowerMetrics system**

  - [ ] Track CPU wake-up frequency
  - [ ] Monitor active timer count
  - [ ] Count goroutine usage
  - [ ] Measure rendering call frequency

- [ ] **Implement performance profiling**

  - [ ] Add CPU profiling integration
  - [ ] Create memory allocation tracking
  - [ ] Implement battery usage estimation
  - [ ] Add performance regression detection

- [ ] **Create optimization dashboard**
  - [ ] Build real-time metrics display
  - [ ] Add performance trend analysis
  - [ ] Create optimization recommendations
  - [ ] Implement A/B testing framework

**New files to create:**

- `internal/util/power_metrics.go`
- `internal/util/performance_profiler.go`
- `internal/components/debug/metrics_dashboard.go`

## Responsiveness and Stability Code Examples

### Critical Fix 1: Non-blocking API Operations

```go
// Current problematic code in app.go:775-789
cmds = append(cmds, func() tea.Msg {
    _, err := a.Client.Session.Chat(ctx, a.Session.ID, opencode.SessionChatParams{
        // ... params
    })
    if err != nil {
        return toast.NewErrorToast(errormsg)()
    }
    return nil
})

// FIXED VERSION - Non-blocking with progress indication
type APIOperation struct {
    Type      string
    InProgress bool
    Cancel    context.CancelFunc
}

func (a *App) SendPromptAsync(ctx context.Context, prompt Prompt) (*App, tea.Cmd) {
    // Immediate UI feedback
    a.SetBusy(true)

    // Background operation
    return a, func() tea.Msg {
        ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()

        go func() {
            defer func() {
                if r := recover(); r != nil {
                    slog.Error("API operation panicked", "error", r)
                }
            }()

            _, err := a.Client.Session.Chat(ctx, a.Session.ID, params)
            if err != nil {
                // Send error back to UI thread
                tea.Send(APIErrorMsg{Error: err})
                return
            }
            tea.Send(APISuccessMsg{})
        }()

        return APIOperationStartedMsg{}
    }
}
```

### Critical Fix 2: Safe Clipboard Operations

```go
// Current problematic code in editor.go:517-540
func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
    imageBytes := clipboard.Read(clipboard.FmtImage) // CAN CRASH!
    if imageBytes != nil {
        // ... rest of function
    }
}

// FIXED VERSION - With panic recovery and timeout
func (m *editorComponent) Paste() (tea.Model, tea.Cmd) {
    return m, func() tea.Msg {
        defer func() {
            if r := recover(); r != nil {
                slog.Error("Clipboard operation failed", "error", r)
                return PasteErrorMsg{Error: fmt.Errorf("clipboard error: %v", r)}
            }
        }()

        // Add timeout for clipboard operations
        ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
        defer cancel()

        done := make(chan []byte, 1)
        go func() {
            defer func() {
                if r := recover(); r != nil {
                    done <- nil
                }
            }()
            imageBytes := clipboard.Read(clipboard.FmtImage)
            done <- imageBytes
        }()

        select {
        case imageBytes := <-done:
            if imageBytes != nil {
                return PasteImageMsg{Data: imageBytes}
            }
            return PasteTextMsg{}
        case <-ctx.Done():
            return PasteErrorMsg{Error: fmt.Errorf("clipboard timeout")}
        }
    }
}
```

### Critical Fix 3: Input Buffer During AI Response

```go
// New component: InputBuffer
type InputBuffer struct {
    buffer   []tea.KeyPressMsg
    enabled  bool
    maxSize  int
    mu       sync.Mutex
}

func (ib *InputBuffer) Add(msg tea.KeyPressMsg) {
    ib.mu.Lock()
    defer ib.mu.Unlock()

    if !ib.enabled || len(ib.buffer) >= ib.maxSize {
        return
    }

    ib.buffer = append(ib.buffer, msg)
}

func (ib *InputBuffer) Flush() []tea.KeyPressMsg {
    ib.mu.Lock()
    defer ib.mu.Unlock()

    msgs := make([]tea.KeyPressMsg, len(ib.buffer))
    copy(msgs, ib.buffer)
    ib.buffer = ib.buffer[:0]
    return msgs
}

// Updated Update() method in tui.go
func (a Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyPressMsg:
        // If AI is busy, buffer the input instead of blocking
        if a.app.IsBusy() && !isSystemKey(msg) {
            a.inputBuffer.Add(msg)
            return a, nil
        }

        // Normal processing
        return a.processKeyPress(msg)

    case AIResponseCompleteMsg:
        // Flush buffered inputs when AI is done
        a.app.SetBusy(false)
        bufferedInputs := a.inputBuffer.Flush()

        var cmds []tea.Cmd
        for _, input := range bufferedInputs {
            _, cmd := a.processKeyPress(input)
            if cmd != nil {
                cmds = append(cmds, cmd)
            }
        }
        return a, tea.Batch(cmds...)
    }
}
```

### Critical Fix 4: Thread-Safe State Management

```go
// New component: ThreadSafeAppState
type ThreadSafeAppState struct {
    mu       sync.RWMutex
    busy     bool
    messages []app.Message
    session  *opencode.Session
}

func (s *ThreadSafeAppState) IsBusy() bool {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.busy
}

func (s *ThreadSafeAppState) SetBusy(busy bool) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.busy = busy
}

func (s *ThreadSafeAppState) AddMessage(msg app.Message) {
    s.mu.Lock()
    defer s.mu.Unlock()
    s.messages = append(s.messages, msg)
}

func (s *ThreadSafeAppState) GetMessages() []app.Message {
    s.mu.RLock()
    defer s.mu.RUnlock()

    // Return copy to prevent race conditions
    msgs := make([]app.Message, len(s.messages))
    copy(msgs, s.messages)
    return msgs
}
```

## Testing and Validation

### Responsiveness Testing

- [ ] **Create stress test suite**

  - [ ] Test rapid typing while AI is responding
  - [ ] Test large clipboard paste operations
  - [ ] Test network timeout scenarios
  - [ ] Test concurrent user operations

- [ ] **Test crash scenarios**

  - [ ] Clipboard access while another app is using it
  - [ ] Network failures during critical operations
  - [ ] Memory exhaustion scenarios
  - [ ] Rapid UI state changes

- [ ] **Performance validation**
  - [ ] Measure input lag before/after fixes
  - [ ] Test UI responsiveness during network operations
  - [ ] Validate no input loss during buffering
  - [ ] Check memory usage under load

## Delivery Milestones

### Phase 0 Milestone (Days 1-2) - CRITICAL

- [ ] No more crashes from clipboard operations
- [ ] Text input works while AI is responding
- [ ] No UI freezing during network calls
- [ ] Basic panic recovery implemented
- [ ] Input buffering functional

### Week 1 Milestone

- [ ] **Create benchmark suite**

  - [ ] CPU usage benchmarks for each optimization
  - [ ] Memory allocation benchmarks
  - [ ] Rendering performance benchmarks
  - [ ] Network call efficiency benchmarks

- [ ] **Implement automated testing**
  - [ ] Unit tests for all new components
  - [ ] Integration tests for optimization features
  - [ ] Performance regression tests
  - [ ] Power consumption validation tests

### Real-world Testing

- [ ] **Battery life testing**

  - [ ] Test on various laptop models
  - [ ] Measure battery drain during different usage patterns
  - [ ] Compare before/after optimization results
  - [ ] Document power savings across different hardware

- [ ] **User experience validation**
  - [ ] Ensure optimizations don't degrade UX
  - [ ] Test responsiveness improvements
  - [ ] Validate animation quality
  - [ ] Check for optimization side effects

## Documentation and Maintenance

### Documentation Updates

- [ ] **Update technical documentation**

  - [ ] Document new architecture components
  - [ ] Create optimization configuration guide
  - [ ] Add troubleshooting section
  - [ ] Update performance tuning guide

- [ ] **Create monitoring documentation**
  - [ ] Document metrics and their meanings
  - [ ] Create alerting setup guide
  - [ ] Add debugging procedures
  - [ ] Document optimization best practices

### Configuration Management

- [ ] **Add optimization configuration options**

  - [ ] Animation timing configuration
  - [ ] Cache size settings
  - [ ] Worker pool size tuning
  - [ ] Power saving mode toggle

- [ ] **Implement dynamic tuning**
  - [ ] Runtime optimization adjustment
  - [ ] Automatic performance mode switching
  - [ ] User preference integration
  - [ ] Hardware-specific optimizations

## Delivery Milestones

### Week 1 Milestone

- [ ] Adaptive animation system functional
- [ ] API debouncing implemented
- [ ] 15-20% idle power reduction achieved
- [ ] Basic metrics collection in place

### Week 3 Milestone

- [ ] Centralized timer management deployed
- [ ] View caching system operational
- [ ] 25-30% power reduction in typical usage
- [ ] Performance monitoring dashboard ready

### Week 6 Milestone

- [ ] Full optimization suite deployed
- [ ] Memory management optimized
- [ ] 30-35% overall power reduction achieved
- [ ] Complete documentation and testing finished

## Success Criteria

### Quantitative Metrics

- [ ] **25-35% reduction in idle CPU usage**
- [ ] **15-25% reduction in active power consumption**
- [ ] **10-20% improvement in battery life**
- [ ] **40-60% reduction in API call frequency**
- [ ] **20-30% faster UI responsiveness**

### Qualitative Metrics

- [ ] **No degradation in user experience**
- [ ] **Maintained or improved UI responsiveness**
- [ ] **Stable application performance**
- [ ] **Clean, maintainable code architecture**

---

## IMMEDIATE ACTION PLAN (Next 48 Hours)

### Day 1 - Critical Stability

1. **Fix clipboard crashes** - Add panic recovery to `editor.go:517-540`
2. **Make API calls non-blocking** - Move network operations to background goroutines
3. **Add input buffering** - Allow typing while AI responds
4. **Basic error boundaries** - Wrap Update() methods with recovery

### Day 2 - Threading Architecture

1. **Thread-safe state** - Add mutex protection to shared app state
2. **Proper goroutine lifecycle** - Add context cancellation and cleanup
3. **Input/output separation** - Separate UI updates from network operations
4. **Comprehensive testing** - Test all crash scenarios

### Day 3 - Resource Management

1. **Fix context usage** - Replace all `context.Background()` with timeouts
2. **Resource cleanup** - Fix file watcher and channel leaks
3. **Memory safety** - Add bounds checking and nil guards
4. **Complete TODOs** - Address unfinished error handling

### Expected Result After Phase 0

- **Zero crashes** during normal operation
- **Always responsive** text input (even during AI responses)
- **No UI freezing** on network calls or clipboard operations
- **No resource leaks** during extended usage
- **Professional-grade stability** that users can rely on

## CRITICAL ISSUES DISCOVERED:

### 🚨 **High Severity Crashes:**

1. **Clipboard panic** - Direct crash on image paste failure
2. **Infinite loops** - Git watcher can't be stopped properly
3. **Context leaks** - 38+ instances of `context.Background()` without timeouts
4. **Unsafe memory** - Windows clipboard using unsafe.Pointer without validation
5. **Race conditions** - Shared state access without synchronization

### ⚠️ **Medium Severity Issues:**

1. **Incomplete features** - TODOs in message handling that could cause panics
2. **Resource leaks** - File watchers and channels not properly closed
3. **Debug code** - Production println() statements affecting performance
4. **Bounds errors** - Array access without validation

### 📋 **Low Severity (But Important):**

1. **Error propagation** - Network failures not surfaced properly
2. **Fallback behaviors** - Missing graceful degradation
3. **User experience** - Cryptic error messages

The current threading issues are the #1 priority - power optimization is secondary to basic stability and responsiveness. Users expect a TUI to be snappy and reliable, especially for text input operations.

## Notes

- **Phase 0 is CRITICAL** - stability fixes must come before power optimizations
- **Test thoroughly** - each fix should be validated against crash scenarios
- **Measure responsiveness** - input lag should never exceed 100ms
- **Gradual rollout** - implement fixes incrementally to avoid introducing new issues
- **User feedback** - test with real users to validate improvements
