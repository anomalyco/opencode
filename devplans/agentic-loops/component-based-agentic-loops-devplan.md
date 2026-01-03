# Component-Based Agentic Loops: Implementation Architecture

> Document created: January 2026
> Author: OpenCode Research
> Purpose: Design and implement a component-based architecture for customizable and programmable agentic loops

---

## Executive Summary

**Current Problem:** The existing agentic loop architecture uses monolithic implementations (react.ts, plan-execute.ts) that are difficult to extend, customize, and maintain.

**Proposed Solution:** A component-based architecture where agentic loops are composed from reusable, configurable components - similar to how modern web frameworks build UIs from components.

**Benefits:**
- **Modularity**: Components can be reused across different loop patterns
- **Extensibility**: New loop types created by composing existing components
- **Configurability**: Loops customized via configuration, not code changes
- **Maintainability**: Single responsibility components are easier to test and debug
- **Programmability**: Visual and declarative loop construction

**Implementation Approach:**
1. Component registry system for reusable building blocks
2. Declarative loop definitions using component composition
3. Runtime executor that orchestrates component execution
4. UI builder for creating custom loops
5. Migration path from monolithic to component-based architecture

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Component Types](#2-component-types)
3. [Loop Definition Format](#3-loop-definition-format)
4. [Component Registry](#4-component-registry)
5. [Loop Executor](#5-loop-executor)
6. [Implementation Phases](#6-implementation-phases)
7. [Migration Strategy](#7-migration-strategy)
8. [UI Components](#8-ui-components)
9. [Testing Strategy](#9-testing-strategy)
10. [Code Examples](#10-code-examples)

---

## 1. Architecture Overview

### Core Concepts

**Component**: A reusable, configurable building block that performs a specific function in an agentic loop (e.g., reasoning, tool execution, observation processing).

**Loop Definition**: A declarative specification that defines which components to use, how they're configured, and how data flows between them.

**Component Registry**: Central catalog of available component types and their implementations.

**Loop Executor**: Runtime engine that instantiates components, manages data flow, and orchestrates execution according to the loop definition.

### High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Loop Builder  │    │  Component       │    │   Loop Runtime  │
│   (UI/Editor)   │───▶│  Registry        │───▶│   Executor      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Loop Definition │    │ Component        │    │ Execution       │
│ (JSON/YAML)     │    │ Implementations  │    │ Results         │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Data Flow

1. **Design Time**: User creates loop definition using builder UI or declarative format
2. **Registration**: Components register themselves with the registry
3. **Runtime**: Executor instantiates components, manages state, orchestrates execution
4. **Execution**: Components process data in sequence, passing results via defined interfaces

---

## 2. Component Types

### 2.1 Input Processing Components

**Purpose**: Handle initial input processing and context gathering.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `UserInputParser` | Parse and validate user messages | `raw_message` | `parsed_input`, `intent` | `validation_rules`, `intent_extraction` |
| `ContextRetriever` | Fetch conversation history, files | `session_id`, `message_id` | `conversation_history`, `relevant_files` | `context_window`, `file_filters` |
| `TaskAnalyzer` | Analyze task complexity and requirements | `parsed_input` | `task_type`, `complexity_score`, `requirements` | `analysis_model`, `complexity_thresholds` |

### 2.2 Reasoning Components

**Purpose**: Generate reasoning, planning, and decision-making logic.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `ChainOfThought` | Generate step-by-step reasoning | `task`, `context` | `reasoning_trace`, `next_action` | `reasoning_prompt`, `max_steps` |
| `CritiqueAnalyzer` | Self-reflection and error analysis | `current_state`, `previous_actions` | `critique`, `improvement_suggestions` | `critique_prompt`, `reflection_depth` |
| `PlanGenerator` | Create structured execution plans | `task`, `constraints` | `execution_plan`, `task_breakdown` | `planning_strategy`, `max_subtasks` |

### 2.3 Action Selection Components

**Purpose**: Choose appropriate actions based on reasoning and context.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `ToolSelector` | Choose tools based on reasoning | `reasoning`, `available_tools` | `selected_tool`, `tool_params` | `selection_criteria`, `fallback_tools` |
| `MultiOptionEvaluator` | Score and rank action choices | `candidate_actions` | `ranked_actions`, `best_action` | `evaluation_criteria`, `scoring_weights` |
| `SafetyChecker` | Validate actions against policies | `proposed_action`, `safety_rules` | `is_safe`, `safety_violations` | `policy_rules`, `violation_threshold` |

### 2.4 Execution Components

**Purpose**: Execute selected actions and handle results.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `ToolExecutor` | Execute tools with parameters | `tool_name`, `params` | `execution_result`, `success` | `timeout`, `retry_policy` |
| `ParallelProcessor` | Handle concurrent executions | `execution_requests` | `results_array` | `max_concurrency`, `timeout` |
| `SubtaskSpawner` | Create child agents/tasks | `subtask_definition` | `subtask_id`, `spawn_result` | `resource_limits`, `isolation_level` |

### 2.5 Observation Components

**Purpose**: Process execution results and extract insights.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `ResultParser` | Parse and normalize results | `raw_result` | `parsed_data`, `metadata` | `parsing_rules`, `normalization` |
| `QualityEvaluator` | Assess outcome quality | `result`, `criteria` | `quality_score`, `feedback` | `evaluation_model`, `quality_thresholds` |
| `LearningExtractor` | Extract insights for improvement | `execution_history` | `learned_patterns`, `improvements` | `learning_algorithm`, `pattern_types` |

### 2.6 Control Flow Components

**Purpose**: Manage loop execution, state, and termination.

| Component | Description | Inputs | Outputs | Config |
|-----------|-------------|--------|---------|--------|
| `TerminationChecker` | Decide when to stop iterating | `current_state`, `history` | `should_continue`, `reason` | `termination_conditions`, `max_iterations` |
| `StateUpdater` | Update loop state and memory | `current_state`, `new_data` | `updated_state` | `state_schema`, `persistence_rules` |
| `RetryHandler` | Handle failures and retries | `failure_info`, `retry_policy` | `retry_decision`, `retry_params` | `retry_strategies`, `max_retries` |

---

## 3. Loop Definition Format

### 3.1 Structure

A loop definition is a declarative specification that defines:

```typescript
interface LoopDefinition {
  id: string
  name: string
  description: string
  version: string
  components: ComponentDefinition[]
  dataflow: DataFlowRule[]
  metadata?: Record<string, any>
}

interface ComponentDefinition {
  id: string
  type: string
  name?: string
  description?: string
  config: Record<string, any>
  inputs: string[]
  outputs: string[]
}

interface DataFlowRule {
  from: string      // "component_id.output_name"
  to: string        // "component_id.input_name"
  transform?: string // Optional transformation function
}
```

### 3.2 Example: ReAct Loop

```json
{
  "id": "react",
  "name": "Reasoning + Acting",
  "description": "Classic ReAct pattern with explicit reasoning and action",
  "version": "1.0.0",
  "components": [
    {
      "id": "reasoning",
      "type": "ChainOfThought",
      "name": "Reasoning Generator",
      "config": {
        "prompt": "Think step by step about what to do next. Format: THOUGHT: {reasoning} ACTION: {action}",
        "max_tokens": 500
      },
      "inputs": ["task", "previous_observation"],
      "outputs": ["reasoning_trace", "selected_action"]
    },
    {
      "id": "tool_executor",
      "type": "ToolExecutor",
      "name": "Tool Execution",
      "config": {
        "timeout": 30000,
        "retry_policy": "exponential_backoff"
      },
      "inputs": ["selected_action"],
      "outputs": ["execution_result", "success"]
    },
    {
      "id": "observation_processor",
      "type": "ResultParser",
      "name": "Observation Processor",
      "config": {
        "format_for_reasoning": true,
        "extract_insights": true
      },
      "inputs": ["execution_result"],
      "outputs": ["observation", "insights"]
    },
    {
      "id": "termination_checker",
      "type": "TerminationChecker",
      "name": "Loop Terminator",
      "config": {
        "conditions": [
          {"type": "task_completed", "pattern": "FINISHED|COMPLETE"},
          {"type": "max_iterations", "value": 20},
          {"type": "error_count", "value": 3}
        ]
      },
      "inputs": ["observation", "iteration_count", "error_count"],
      "outputs": ["should_continue", "termination_reason"]
    }
  ],
  "dataflow": [
    {
      "from": "reasoning.selected_action",
      "to": "tool_executor.selected_action"
    },
    {
      "from": "tool_executor.execution_result",
      "to": "observation_processor.execution_result"
    },
    {
      "from": "observation_processor.observation",
      "to": "reasoning.previous_observation"
    },
    {
      "from": "observation_processor.observation",
      "to": "termination_checker.observation"
    }
  ]
}
```

### 3.3 Example: Plan-Execute Loop

```json
{
  "id": "plan_execute",
  "name": "Plan-Execute Pattern",
  "description": "Separate planning phase from execution phase",
  "version": "1.0.0",
  "components": [
    {
      "id": "task_analyzer",
      "type": "TaskAnalyzer",
      "config": {
        "analysis_depth": "detailed",
        "identify_dependencies": true
      },
      "inputs": ["user_request"],
      "outputs": ["task_breakdown", "complexity"]
    },
    {
      "id": "plan_generator",
      "type": "PlanGenerator",
      "config": {
        "strategy": "hierarchical",
        "max_subtasks": 10
      },
      "inputs": ["task_breakdown", "constraints"],
      "outputs": ["execution_plan", "task_sequence"]
    },
    {
      "id": "step_executor",
      "type": "ToolExecutor",
      "config": {
        "parallel_execution": true,
        "max_concurrency": 3
      },
      "inputs": ["current_step", "plan_context"],
      "outputs": ["step_result", "completion_status"]
    },
    {
      "id": "progress_tracker",
      "type": "StateUpdater",
      "config": {
        "track_completion": true,
        "update_dependencies": true
      },
      "inputs": ["step_result", "execution_plan"],
      "outputs": ["updated_plan", "next_steps"]
    }
  ],
  "dataflow": [
    {
      "from": "task_analyzer.task_breakdown",
      "to": "plan_generator.task_breakdown"
    },
    {
      "from": "plan_generator.execution_plan",
      "to": "step_executor.plan_context"
    },
    {
      "from": "step_executor.step_result",
      "to": "progress_tracker.step_result"
    },
    {
      "from": "progress_tracker.updated_plan",
      "to": "step_executor.plan_context"
    }
  ]
}
```

---

## 4. Component Registry

### 4.1 Registry Interface

```typescript
interface ComponentRegistry {
  register(type: string, factory: ComponentFactory): void
  unregister(type: string): void
  getFactory(type: string): ComponentFactory | null
  listTypes(): string[]
  validateDefinition(definition: ComponentDefinition): ValidationResult
}

interface ComponentFactory {
  create(config: Record<string, any>): LoopComponent
  getSchema(): ComponentSchema
  validateConfig(config: Record<string, any>): ValidationResult
}

interface LoopComponent {
  id: string
  type: string
  config: Record<string, any>

  initialize(context: ComponentContext): Promise<void>
  execute(inputs: Record<string, any>): Promise<Record<string, any>>
  cleanup(): Promise<void>

  getMetadata(): ComponentMetadata
}

interface ComponentContext {
  sessionID: string
  loopID: string
  componentID: string
  sharedState: Map<string, any>
  logger: Logger
}
```

### 4.2 Built-in Components

The registry comes pre-populated with essential components:

```typescript
// Register core components
registry.register("ChainOfThought", new ChainOfThoughtFactory())
registry.register("ToolExecutor", new ToolExecutorFactory())
registry.register("TerminationChecker", new TerminationCheckerFactory())
// ... etc
```

### 4.3 Custom Component Development

Developers can create custom components:

```typescript
class CustomReasoningComponent implements LoopComponent {
  async execute(inputs: Record<string, any>): Promise<Record<string, any>> {
    // Custom reasoning logic
    return { reasoning: "Custom analysis", confidence: 0.8 }
  }
}

// Register custom component
registry.register("CustomReasoning", {
  create: (config) => new CustomReasoningComponent(config),
  getSchema: () => ({ /* schema definition */ }),
  validateConfig: (config) => ({ valid: true })
})
```

---

## 5. Loop Executor

### 5.1 Executor Interface

```typescript
interface LoopExecutor {
  execute(
    definition: LoopDefinition,
    initialInputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<ExecutionResult>
}

interface ExecutionContext {
  sessionID: string
  userID: string
  abortSignal?: AbortSignal
  maxIterations?: number
  timeout?: number
}

interface ExecutionResult {
  success: boolean
  outputs: Record<string, any>
  executionTrace: ExecutionStep[]
  duration: number
  error?: string
}

interface ExecutionStep {
  step: number
  componentID: string
  inputs: Record<string, any>
  outputs: Record<string, any>
  duration: number
  timestamp: number
}
```

### 5.2 Execution Algorithm

```typescript
class ComponentLoopExecutor implements LoopExecutor {
  async execute(
    definition: LoopDefinition,
    initialInputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<ExecutionResult> {

    // 1. Validate definition
    const validation = this.validateDefinition(definition)
    if (!validation.valid) {
      throw new Error(`Invalid loop definition: ${validation.errors}`)
    }

    // 2. Create component instances
    const components = new Map<string, LoopComponent>()
    for (const compDef of definition.components) {
      const factory = registry.getFactory(compDef.type)
      if (!factory) {
        throw new Error(`Unknown component type: ${compDef.type}`)
      }
      const component = factory.create(compDef.config)
      await component.initialize({
        sessionID: context.sessionID,
        loopID: definition.id,
        componentID: compDef.id,
        sharedState: new Map(),
        logger: this.logger
      })
      components.set(compDef.id, component)
    }

    // 3. Initialize data store
    const dataStore = new Map<string, any>()
    for (const [key, value] of Object.entries(initialInputs)) {
      dataStore.set(key, value)
    }

    // 4. Execute loop
    const executionTrace: ExecutionStep[] = []
    const startTime = Date.now()
    let iteration = 0

    try {
      while (!context.abortSignal?.aborted && iteration < (context.maxIterations || 100)) {
        iteration++

        // Execute components in topological order
        for (const compDef of definition.components) {
          const component = components.get(compDef.id)!

          // Gather inputs from data store
          const inputs = this.gatherInputs(compDef, dataStore)

          // Execute component
          const stepStart = Date.now()
          const outputs = await component.execute(inputs)
          const stepDuration = Date.now() - stepStart

          // Store outputs
          for (const [outputKey, outputValue] of Object.entries(outputs)) {
            dataStore.set(`${compDef.id}.${outputKey}`, outputValue)
          }

          // Record execution step
          executionTrace.push({
            step: iteration,
            componentID: compDef.id,
            inputs,
            outputs,
            duration: stepDuration,
            timestamp: Date.now()
          })

          // Apply data flow rules
          this.applyDataFlow(definition.dataflow, dataStore)
        }

        // Check termination conditions
        const shouldContinue = this.checkTermination(dataStore)
        if (!shouldContinue) break
      }

      return {
        success: true,
        outputs: Object.fromEntries(dataStore),
        executionTrace,
        duration: Date.now() - startTime
      }

    } catch (error) {
      return {
        success: false,
        outputs: Object.fromEntries(dataStore),
        executionTrace,
        duration: Date.now() - startTime,
        error: error.message
      }
    } finally {
      // Cleanup components
      for (const component of components.values()) {
        await component.cleanup()
      }
    }
  }
}
```

---

## 6. Implementation Phases

### Phase 1: Foundation (2-3 weeks)

**Goals:** Establish core infrastructure for component-based loops.

| Task | Effort | Description |
|------|--------|-------------|
| Component Registry | 3 days | Create component registration and instantiation system |
| Base Component Types | 5 days | Implement core component interfaces and base classes |
| Loop Definition Schema | 2 days | Define JSON schema for loop definitions |
| Basic Executor | 4 days | Implement core execution engine with data flow |
| Integration Tests | 3 days | Test component composition and execution |
| **Total** | **17 days** | Foundation infrastructure |

### Phase 2: Core Components (3-4 weeks)

**Goals:** Implement essential components for common loop patterns.

| Task | Effort | Description |
|------|--------|-------------|
| Input Processing | 3 days | UserInputParser, ContextRetriever, TaskAnalyzer |
| Reasoning Components | 4 days | ChainOfThought, CritiqueAnalyzer, PlanGenerator |
| Action Selection | 3 days | ToolSelector, MultiOptionEvaluator, SafetyChecker |
| Execution Components | 4 days | ToolExecutor, ParallelProcessor, SubtaskSpawner |
| Observation Components | 3 days | ResultParser, QualityEvaluator, LearningExtractor |
| Control Flow | 3 days | TerminationChecker, StateUpdater, RetryHandler |
| **Total** | **20 days** | Core component library |

### Phase 3: Loop Patterns (2-3 weeks)

**Goals:** Convert existing monolithic loops to component-based definitions.

| Task | Effort | Description |
|------|--------|-------------|
| ReAct Loop Definition | 2 days | Convert react.ts to component definition |
| Plan-Execute Definition | 3 days | Convert plan-execute.ts to component definition |
| Tree of Thoughts | 4 days | Create ToT component definition |
| Reflexion Loop | 3 days | Create reflexion component definition |
| Multi-Agent Debate | 4 days | Create debate component definition |
| Loop Validation | 2 days | Validate all loop definitions |
| **Total** | **18 days** | Loop pattern migration |

### Phase 4: UI Builder (2-3 weeks)

**Goals:** Create visual interface for building custom loops.

| Task | Effort | Description |
|------|--------|-------------|
| Component Palette | 3 days | Visual component selection interface |
| Canvas Interface | 4 days | Drag-and-drop loop construction |
| Configuration Panels | 3 days | Component configuration UI |
| Data Flow Editor | 4 days | Visual data flow connection editor |
| Loop Testing | 3 days | Integrated testing and debugging |
| Loop Library | 2 days | Save/load/share loop definitions |
| **Total** | **19 days** | Visual loop builder |

### Phase 5: Integration & Optimization (2 weeks)

**Goals:** Integrate with existing OpenCode and optimize performance.

| Task | Effort | Description |
|------|--------|-------------|
| Backend Integration | 3 days | Integrate with existing session/prompt.ts |
| UI Integration | 3 days | Add loop selection to prompt-input.tsx |
| Performance Optimization | 3 days | Optimize component execution and data flow |
| Monitoring & Metrics | 2 days | Add performance tracking and debugging |
| Documentation | 2 days | Update docs and create examples |
| **Total** | **13 days** | Integration and polish |

**Total Effort:** ~87 days (3-4 months)

---

## 7. Migration Strategy

### 7.1 Backward Compatibility

**Goal:** Ensure existing loops continue working during transition.

1. **Wrapper Adapters:** Create adapter components that wrap existing monolithic loops
2. **Gradual Migration:** Migrate one loop pattern at a time
3. **Fallback System:** Default to legacy implementation if component-based fails

### 7.2 Migration Steps

1. **Phase 1:** Implement component system alongside existing code
2. **Phase 2:** Create component-based versions of existing loops
3. **Phase 3:** Add feature flag to switch between implementations
4. **Phase 4:** Gradually migrate users and remove legacy code

### 7.3 Data Migration

- Loop definitions stored in database with versioning
- User preferences migrate automatically
- Session state remains compatible

---

## 8. UI Components

### 8.1 Loop Builder Interface

```tsx
// packages/app/src/components/loop-builder.tsx
export function LoopBuilder() {
  const [definition, setDefinition] = createSignal<LoopDefinition>()
  const [selectedComponent, setSelectedComponent] = createSignal<string>()

  return (
    <div class="loop-builder">
      {/* Component Palette */}
      <div class="component-palette">
        {componentTypes.map(type => (
          <div
            class="component-item"
            draggable
            onDragStart={() => setSelectedComponent(type)}
          >
            {type}
          </div>
        ))}
      </div>

      {/* Canvas */}
      <div class="canvas">
        <LoopCanvas
          definition={definition()}
          onUpdate={setDefinition}
          onDrop={(position) => addComponent(selectedComponent(), position)}
        />
      </div>

      {/* Configuration Panel */}
      <div class="config-panel">
        <ComponentConfig
          component={selectedComponentDetails()}
          onChange={(config) => updateComponentConfig(config)}
        />
      </div>
    </div>
  )
}
```

### 8.2 Loop Selector

```tsx
// packages/app/src/components/loop-selector.tsx
export function LoopSelector() {
  const loops = createMemo(() => loopRegistry.list())
  const currentLoop = createMemo(() => local.loop.current())

  return (
    <Select
      label="Agentic Loop"
      options={loops().map(l => ({ value: l.id, label: l.name }))}
      current={currentLoop()}
      onSelect={(loopId) => local.loop.set(loopId)}
    />
  )
}
```

---

## 9. Testing Strategy

### 9.1 Component Testing

```typescript
// Test individual components
describe("ChainOfThought", () => {
  it("generates reasoning trace", async () => {
    const component = new ChainOfThought({ prompt: "Think step by step" })
    const result = await component.execute({
      task: "Solve 2+2",
      context: []
    })
    expect(result.reasoning_trace).toBeDefined()
  })
})
```

### 9.2 Loop Integration Testing

```typescript
// Test complete loop execution
describe("ReAct Loop", () => {
  it("executes reasoning-action-observation cycle", async () => {
    const definition = loadLoopDefinition("react")
    const result = await executor.execute(definition, {
      task: "What is the capital of France?"
    })

    expect(result.success).toBe(true)
    expect(result.executionTrace).toHaveLength.greaterThan(1)
  })
})
```

### 9.3 Performance Testing

- Component execution latency benchmarks
- Memory usage monitoring
- Concurrent execution stress tests
- Loop definition validation performance

---

## 10. Code Examples

### 10.1 Custom Component Implementation

```typescript
// packages/opencode/src/loop/components/custom-reasoning.ts
export class CustomReasoningComponent implements LoopComponent {
  constructor(private config: { model: string, temperature: number }) {}

  async initialize(context: ComponentContext): Promise<void> {
    // Setup component state
    this.context = context
  }

  async execute(inputs: Record<string, any>): Promise<Record<string, any>> {
    const { task, previous_observation } = inputs

    // Generate custom reasoning
    const reasoning = await this.generateReasoning(task, previous_observation)

    return {
      reasoning_trace: reasoning,
      confidence: this.calculateConfidence(reasoning),
      next_action: this.extractAction(reasoning)
    }
  }

  async cleanup(): Promise<void> {
    // Cleanup resources
  }

  private async generateReasoning(task: string, observation?: string): Promise<string> {
    const prompt = `Task: ${task}\n${observation ? `Previous result: ${observation}\n` : ''}Reason step by step:`
    return await llm.generate(prompt, this.config)
  }

  private calculateConfidence(reasoning: string): number {
    // Simple confidence calculation
    return reasoning.includes("certain") ? 0.9 : 0.7
  }

  private extractAction(reasoning: string): string {
    // Extract action from reasoning
    const actionMatch = reasoning.match(/ACTION:\s*(.+)/i)
    return actionMatch ? actionMatch[1].trim() : "finish"
  }
}

// Register component
registry.register("CustomReasoning", {
  create: (config) => new CustomReasoningComponent(config),
  getSchema: () => ({
    type: "object",
    properties: {
      model: { type: "string", default: "gpt-4" },
      temperature: { type: "number", minimum: 0, maximum: 2, default: 0.7 }
    }
  }),
  validateConfig: (config) => {
    const errors: string[] = []
    if (!config.model) errors.push("model is required")
    if (config.temperature < 0 || config.temperature > 2) {
      errors.push("temperature must be between 0 and 2")
    }
    return { valid: errors.length === 0, errors }
  }
})
```

### 10.2 Loop Definition with Custom Component

```json
{
  "id": "custom_reasoning_loop",
  "name": "Custom Reasoning Loop",
  "description": "Loop using custom reasoning component",
  "version": "1.0.0",
  "components": [
    {
      "id": "custom_reasoner",
      "type": "CustomReasoning",
      "name": "Advanced Reasoner",
      "config": {
        "model": "gpt-4-turbo",
        "temperature": 0.3
      },
      "inputs": ["task", "previous_observation"],
      "outputs": ["reasoning_trace", "confidence", "next_action"]
    },
    {
      "id": "tool_executor",
      "type": "ToolExecutor",
      "config": { "timeout": 30000 },
      "inputs": ["next_action"],
      "outputs": ["execution_result", "success"]
    },
    {
      "id": "termination_checker",
      "type": "TerminationChecker",
      "config": {
        "conditions": [
          {"type": "confidence_threshold", "value": 0.95},
          {"type": "max_iterations", "value": 15}
        ]
      },
      "inputs": ["confidence", "iteration_count"],
      "outputs": ["should_continue"]
    }
  ],
  "dataflow": [
    {
      "from": "custom_reasoner.next_action",
      "to": "tool_executor.next_action"
    },
    {
      "from": "tool_executor.execution_result",
      "to": "custom_reasoner.previous_observation"
    }
  ]
}
```

### 10.3 Dynamic Loop Creation

```typescript
// Create loop programmatically
const dynamicLoop = LoopBuilder.create()
  .addComponent("input_parser", "UserInputParser", {
    validation_rules: ["not_empty", "max_length:1000"]
  })
  .addComponent("reasoner", "ChainOfThought", {
    prompt: "Analyze this request carefully"
  })
  .addComponent("executor", "ToolExecutor", {
    retry_policy: "exponential_backoff"
  })
  .connect("input_parser.parsed_input", "reasoner.task")
  .connect("reasoner.selected_action", "executor.selected_action")
  .connect("executor.execution_result", "reasoner.previous_observation")
  .build()

// Execute the dynamically created loop
const result = await executor.execute(dynamicLoop, {
  raw_message: "Help me refactor this code"
})
```

---

## Conclusion

The component-based agentic loops architecture transforms the current monolithic approach into a modular, extensible, and programmable system. By breaking loops into reusable components, we enable:

- **Rapid Loop Development:** New loop patterns created by composing existing components
- **Visual Programming:** Drag-and-drop loop construction for non-programmers
- **Easy Customization:** Loops adapted via configuration rather than code changes
- **Better Maintainability:** Single-responsibility components are easier to test and debug
- **Extensibility:** Third-party components can extend the system

This architecture represents a significant advancement over the current approach, making agentic loops as composable and reusable as modern UI frameworks.

---

_Document created: January 2026_
_Last updated: January 2026_
