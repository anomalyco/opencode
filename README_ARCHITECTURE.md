# OpenCode Architecture Documentation

This directory contains comprehensive documentation of the OpenCode codebase architecture, specifically focused on implementing trajectory recording functionality.

## Documents Overview

### 1. ARCHITECTURE_ANALYSIS.md
**Comprehensive breakdown of the entire system**

Contains:
- Overview of the agent execution flow
- Detailed LLM client architecture
  - Where API calls are made
  - What parameters are passed
  - What responses are returned
  - Multiple LLM call points
- Tool execution system
  - Tool definitions and registry
  - Tool call processing pipeline
  - Tool result storage
- Agent execution loop
  - Main loop structure
  - State management
  - Step tracking
  - Decision logic
- Message and conversation management
  - Storage architecture
  - History building
  - Message accumulation
  - Part types
  - Filtering and compaction

### 2. ARCHITECTURE_DETAILED_REFERENCE.md
**Quick reference with code snippets and line numbers**

Contains:
- File locations for all key functions
- Line-by-line code excerpts
- Function signatures
- Critical code flow paths
- Performance and token tracking details
- Plugin integration points
- Error handling and retry logic

### 3. TRAJECTORY_RECORDING_GUIDE.md
**Implementation guide for adding trajectory recording**

Contains:
- System architecture flow diagram
- Key injection points (6 levels)
- Recommended implementation approach
- Data structure schemas
- Storage strategies (3 options)
- Query and analysis APIs
- Performance considerations
- Testing strategy
- Files to create/modify

## Quick Navigation

### Finding Information About...

**LLM API Calls**
- Main call location: `prompt.ts` line 508
- See ARCHITECTURE_ANALYSIS.md section 1.1-1.5
- See DETAILED_REFERENCE.md section 1

**Tool Execution**
- Tool definitions: `tool.ts` and `registry.ts`
- Execution wrapper: `prompt.ts` line 666-725
- Event processing: `processor.ts` line 41-380
- See ARCHITECTURE_ANALYSIS.md section 2
- See DETAILED_REFERENCE.md section 2

**Agent Loop**
- Main loop: `prompt.ts` line 232-612
- See ARCHITECTURE_ANALYSIS.md section 3
- See DETAILED_REFERENCE.md section 3

**Messages & History**
- Conversion: `message-v2.ts` line 551-668
- Storage: `index.ts` line 344-388
- See ARCHITECTURE_ANALYSIS.md section 4
- See DETAILED_REFERENCE.md section 4

**Implementing Trajectory Recording**
- See TRAJECTORY_RECORDING_GUIDE.md
- 6 levels of injection points explained
- Ready-to-use data schemas included

## Key Files Reference

### Core Session Files
- `/src/session/prompt.ts` - Main agent loop & LLM calls
- `/src/session/processor.ts` - Stream event processing
- `/src/session/message-v2.ts` - Message schema & conversion
- `/src/session/index.ts` - Storage operations

### Provider & Model Files
- `/src/provider/provider.ts` - Model loading & SDK initialization
- `/src/agent/agent.ts` - Agent configuration

### Tool Files
- `/src/tool/tool.ts` - Tool base interface
- `/src/tool/registry.ts` - Tool registry & enablement
- `/src/tool/bash.ts` - Example tool (Bash)

## Recommended Reading Order

1. **Start here**: TRAJECTORY_RECORDING_GUIDE.md (understand what you're building)
2. **System overview**: ARCHITECTURE_ANALYSIS.md introduction
3. **Deep dive**: Choose section based on what you're implementing:
   - Trajectory Recording at LLM level? → Section 1
   - Trajectory Recording at tool level? → Section 2
   - Trajectory Recording at agent loop level? → Section 3
4. **Code details**: ARCHITECTURE_DETAILED_REFERENCE.md (reference specific code)

## Key Concepts

### Stream Events
The system uses an event-driven architecture where the LLM returns a stream of typed events:
- text-delta, tool-call, tool-result, step-start, step-finish, etc.
- Each event is processed and stored as message parts
- Perfect for trajectory recording - can record each event

### Message Parts
Messages are composed of typed parts:
- TextPart (output text)
- ToolPart (tool call/execution)
- ReasoningPart (extended thinking)
- StepStartPart, StepFinishPart (boundaries)
- And more...

This granular structure is ideal for trajectory recording.

### Agent Loop Pattern
The agent executes in a loop:
1. Get message history
2. Call LLM with history + context
3. Process streaming events (capture tool calls, text, etc.)
4. Store results in message parts
5. Check if done; if not, loop back to step 1

### Tool Execution
Tools are wrapped at the point of use with:
- Before hook (Plugin.trigger)
- Actual execution
- After hook (Plugin.trigger)
- Result storage

Perfect injection points for trajectory recording.

## Implementation Checklist

- [ ] Read TRAJECTORY_RECORDING_GUIDE.md
- [ ] Choose injection points for your use case
- [ ] Design data schema
- [ ] Create TrajectoryRecorder module
- [ ] Add hooks at 6 levels
- [ ] Test with sample session
- [ ] Add query/export APIs
- [ ] Document for users
- [ ] Add to main exports

## Common Questions

**Q: Where do I add trajectory recording?**
A: See TRAJECTORY_RECORDING_GUIDE.md Levels 1-6. Start with Level 1 (high-level) then add Level 2, 3, etc. as needed.

**Q: What data should I record?**
A: See ARCHITECTURE_ANALYSIS.md section 4 and TRAJECTORY_RECORDING_GUIDE.md. Schemas are provided.

**Q: Where do LLM calls happen?**
A: Main call: `prompt.ts` line 508 in `streamText()`. Secondary calls in summary.ts, compaction.ts, agent.ts.

**Q: How is tool execution tracked?**
A: Event-driven in processor.ts. Each tool event (call, result, error) is captured and stored.

**Q: How are messages stored?**
A: Storage namespace: `["message", sessionID, messageID]` and `["part", messageID, partID]`.

## Performance Tips

1. Buffer events in-memory during session
2. Flush to storage after session completes
3. Use separate storage namespace to avoid conflicts
4. Consider compression for stored trajectories
5. Add filtering to reduce captured data if needed

## Next Steps

1. Choose your injection points
2. Create `/src/trajectory/` module
3. Implement recording at chosen levels
4. Add storage and query APIs
5. Test and validate

---

For detailed information about any aspect, refer to the appropriate document above.
