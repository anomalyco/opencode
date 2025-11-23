# Trajectory Recording Tests Summary

## Overview

This document summarizes the tests written for the trajectory recording feature. These tests follow a **test-driven development (TDD)** approach and will initially fail until the implementation is complete.

## Test Philosophy

The tests focus on **what actually matters** for the feature:

1. **JSONL files are created** during conversations
2. **All required events** are recorded in correct order
3. **Event data is complete** and accurate (no truncation)
4. **File format is valid** JSONL that can be parsed
5. **Error handling** fails fast when recording breaks

We avoid trivial tests like:
- ❌ Testing that a config variable has a certain value
- ❌ Testing TypeScript type definitions (TypeScript already validates this)
- ❌ Testing getters/setters without meaningful validation
- ❌ Testing string sanitization without context

## Test Files Created

### 1. `/packages/opencode/test/trajectory/recorder.test.ts`

**Purpose**: Core recorder functionality - file writing, JSONL format, buffering

**Key Tests**:
- ✅ Writes events to JSONL file
- ✅ Maintains valid JSONL format with 100+ events
- ✅ Flushes buffer at end of LLM stream
- ✅ Records complete data without truncation (10KB+ outputs)
- ✅ Appends to file for multiple sessions
- ✅ Throws error if recording fails (fail-fast)
- ✅ Throws if recording to non-existent session

**What This Validates**:
- The recorder can write to disk
- JSONL format is maintained correctly
- Buffering and flushing work as expected
- Large data is not truncated
- Error handling works

---

### 2. `/packages/opencode/test/trajectory/config.test.ts`

**Purpose**: Minimal config validation - just what's needed for the feature

**Key Tests**:
- ✅ Enabled by default
- ✅ Loads trajectory config from `opencode.json`
- ✅ Resolves filename template with all variables
- ✅ Sanitizes model names with slashes for filenames

**What This Validates**:
- Config is loaded correctly
- Filename templates work
- Default behavior is correct

---

### 3. `/packages/opencode/test/trajectory/end-to-end.test.ts`

**Purpose**: **Most important tests** - validate real conversations produce correct JSONL files

**Key Tests** (these are the critical ones):

#### ✅ Creates JSONL file when conversation begins
- Starts a session
- Verifies JSONL file is created
- Parses JSONL to verify valid format
- Checks `session_start` event has all required fields

#### ✅ Records complete conversation flow with all event types
- Executes full conversation (requires mocked LLM)
- Verifies all 7 event types present:
  - `session_start`
  - `llm_interaction` (all 4 call sites)
  - `agent_step` (loop iterations)
  - `tool_execution` (with full args/results)
  - `stream_event` (text-delta, reasoning-delta, tool-call, etc.)
  - `compaction` (if triggered)
  - `session_end`

#### ✅ Records all LLM interactions during session
- Main loop (streamText)
- Title generation (generateText)
- Summary generation (generateText)
- Compaction (streamText)
- Each has complete input/response data

#### ✅ Records tool executions with full arguments
- Tool start (running status)
- Tool end (completed/error status)
- Full tool arguments (no truncation)
- Complete tool results
- Both success and error cases

#### ✅ Records stream events during LLM streaming
- text-delta events
- reasoning-delta events
- tool-call events
- tool-result events
- step-finish events with token usage

#### ✅ Records compaction events when context overflows
- compaction (start) with trigger
- compaction (prune) with stats
- compaction (summarize) LLM call
- compaction (end) with results

#### ✅ Records session_end with complete summary
- Last event in file
- Summary stats match other events
- Total tokens, steps, calls

#### ✅ Maintains valid JSONL throughout session
- Every line is valid JSON
- No corrupted lines during concurrent writes
- Proper newline separation

#### ✅ Uses custom filename template
- All variables resolved (timestamp, agent, model, sessionID)
- File created with correct name

#### ✅ Flushes buffer at end of each LLM stream
- After each streamText() completes
- Events are in file before next LLM call

#### ✅ Fails fast if trajectory write fails
- Invalid path causes immediate error
- Execution halts
- Clear error message

**What This Validates**:
- **The entire feature works end-to-end**
- Real conversations produce correct JSONL files
- All events are captured
- Data is complete and accurate

---

## Implementation Status

**Current Status**: ⚠️ Tests written, **implementation pending**

These tests will initially **fail** because:
1. The trajectory module doesn't exist yet
2. The hooks haven't been added to existing code
3. The config integration isn't implemented

## Next Steps

To make these tests pass:

1. **Phase 1**: Implement trajectory module
   - Create `src/trajectory/types.ts`
   - Create `src/trajectory/recorder.ts`
   - Create `src/trajectory/config.ts`
   - Create `src/trajectory/index.ts`

2. **Phase 2**: Add hooks to existing code
   - Modify `src/session/prompt.ts` (session start/end, loop, tool wrapper)
   - Modify `src/session/processor.ts` (stream events)
   - Modify `src/session/summary.ts` (title/summary generation)
   - Modify `src/session/compaction.ts` (compaction events)

3. **Phase 3**: Run tests
   - `bun test test/trajectory/`
   - Fix any failures
   - Verify all tests pass

4. **Phase 4**: Manual validation
   - Run real conversation
   - Verify JSONL file is created
   - Manually inspect events
   - Validate with analysis tools

## Test Execution

To run these tests:

```bash
# Run all trajectory tests
bun test test/trajectory/

# Run specific test file
bun test test/trajectory/recorder.test.ts
bun test test/trajectory/end-to-end.test.ts

# Run with verbose output
bun test test/trajectory/ --verbose
```

## Success Criteria

Tests pass when:
1. ✅ All JSONL files are created for sessions
2. ✅ All 7 event types are recorded correctly
3. ✅ JSONL format is valid and parseable
4. ✅ Event data is complete (no truncation)
5. ✅ Buffer flushing works correctly
6. ✅ Error handling fails fast
7. ✅ Config and filename templates work

---

## Notes

- **Mocked LLM**: Some end-to-end tests require mocked LLM responses. These are marked with `TODO` in the test file.
- **Manual testing**: Even with tests passing, manual validation with real conversations is recommended.
- **Performance**: Tests don't validate performance, only correctness. Performance testing should be done separately.

---

## File Summary

| Test File | Purpose | Test Count | Status |
|-----------|---------|-----------|---------|
| `recorder.test.ts` | Core file writing & JSONL | 8 tests | ❌ Not implemented |
| `config.test.ts` | Config loading & templates | 4 tests | ❌ Not implemented |
| `end-to-end.test.ts` | **Full conversation flow** | 11 tests | ❌ Not implemented |

**Total**: 23 meaningful tests covering the complete feature.
