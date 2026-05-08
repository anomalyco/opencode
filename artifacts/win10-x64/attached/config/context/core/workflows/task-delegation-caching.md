<!-- Context: workflows/delegation-caching | Priority: medium | Version: 1.0 | Updated: 2026-02-05 -->
# Context Caching for Delegation

**Purpose**: Cache discovered context to avoid re-discovery overhead in repeated tasks

---

## When to Cache

Cache context when:
- Same task type appears multiple times in session
- Same context files needed repeatedly
- Multiple subtasks use identical standards
- Parallel tasks need same context

---

## Cache Structure

```
.tmp/sessions/{session-id}/
├── context.md (main session context)
├── .cache/
│   ├── test-coverage.md (cached from /Users/apple/.config/opencode/context/)
│   ├── code-quality.md
│   └── code-review.md
└── .manifest.json (tracks cache status)
```

---

## Cache Manifest

```json
{
  "session_id": "2026-01-28-parallel-tests",
  "created_at": "2026-01-28T14:30:22Z",
  "cache": {
    "test-coverage.md": {
      "source": "/Users/apple/.config/opencode/context/core/standards/test-coverage.md",
      "cached_at": "2026-01-28T14:30:25Z",
      "used_by": ["subtask_01", "subtask_02"],
      "status": "valid"
    }
  }
}
```

---

## Invalidation Rules

**Cache is INVALID when:**
- Source file modified (check timestamp)
- Session older than 24 hours
- Context file version changed
- User explicitly requests refresh

**Cache is VALID when:**
- Source timestamp matches
- Session less than 24 hours old
- No version changes
- Multiple tasks in same session

---

## Implementation Pattern

```javascript
// Before delegating to subagent
IF cache exists AND cache is valid:
  USE cached context file
  SKIP re-reading from /Users/apple/.config/opencode/context/
ELSE:
  READ from /Users/apple/.config/opencode/context/
  CACHE the file
```

---

## Example: Parallel Tasks

```javascript
session_id = "2026-01-28-parallel-tests"

// Task 1: Write component A (parallel)
task(
  subagent_type="CoderAgent",
  description="Write component A",
  prompt="Load context from .tmp/sessions/{session_id}/context.md
          Use cached context if available at .cache/"
)

// Task 2: Write component B (parallel)  
task(
  subagent_type="CoderAgent",
  description="Write component B",
  prompt="Load context from .tmp/sessions/{session_id}/context.md
          Use cached context if available at .cache/"
)

// Result: Task 1 caches context, Task 2 uses cache (faster)
```

---

## Cache Effectiveness

Track metrics:
```json
{
  "cache_stats": {
    "total_reads": 15,
    "cache_hits": 9,
    "cache_misses": 6,
    "hit_rate": "60%"
  }
}
```

---

## Best Practices

✅ **Do:**
- Cache context for repeated task types
- Validate cache before using
- Invalidate when source changes
- Monitor hit rate
- Clean up cache with session

❌ **Don't:**
- Cache external context (always fetch fresh)
- Cache for single-task sessions (overhead not worth it)
- Ignore invalidation rules
- Mix cached and fresh context in same task

---

## Related

- `task-delegation-basics.md` - Core delegation workflow
- `task-delegation-specialists.md` - When to delegate
