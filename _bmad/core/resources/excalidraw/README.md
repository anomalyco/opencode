# Core Excalidraw Resources

Universal knowledge for creating Excalidraw diagrams. All agents that create Excalidraw files should reference these resources.

## Purpose

Provides the **HOW** (universal knowledge) while agents provide the **WHAT** (domain-specific application).

**Core = "How to create Excalidraw elements"**

- How to group shapes with text labels
- How to calculate text width
- How to create arrows with proper bindings
- How to validate JSON syntax
- Base structure and primitives

**Agents = "What diagrams to create"**

- Frame Expert (BMM): Technical flowcharts, architecture diagrams, wireframes
- Presentation Master (CIS): Pitch decks, creative visuals, Rube Goldberg machines
- Tech Writer (BMM): Documentation diagrams, concept explanations

## Files in This Directory

### excalidraw-helpers.md

**Universal element creation patterns**

- Text width calculation
- Element grouping rules (shapes + labels)
- Grid alignment
- Arrow creation (straight, elbow)
- Theme application
- Validation checklist
- Optimization rules

**Agents reference this to:**

- Create properly grouped shapes
- Calculate text dimensions
- Connect elements with arrows
- Ensure valid structure

### validate-json-instructions.md

**Universal JSON validation process**

- How to validate Excalidraw JSON
- Common errors and fixes
- Workflow integration
- Error recovery

**Agents reference this to:**

- Validate files after creation
- Fix syntax errors
- Ensure files can be opened in Excalidraw

### library-loader.md (Future)

**How to load external .excalidrawlib files**

- Programmatic library loading
- Community library integration
- Custom library management

**Status:** To be developed when implementing external library support.

## How Agents Use These Resources

### Example: Frame Expert (Technical Diagrams)

```yaml
# workflows/excalidraw-diagrams/create-flowchart/workflow.yaml
helpers: '{project-root}/_bmad/core/resources/excalidraw/excalidraw-helpers.md'
json_validation: '{project-root}/_bmad/core/resources/excalidraw/validate-json-instructions.md'
```

**Domain-specific additions:**

```yaml
# workflows/excalidraw-diagrams/_shared/flowchart-templates.yaml
flowchart:
  start_node:
    type: ellipse
    width: 120
    height: 60
  process_box:
    type: rectangle
    width: 160
    height: 80
  decision_diamond:
    type: diamond
    width: 140
    height: 100
```

### Example: Presentation Master (Creative Visuals)

```yaml
# workflows/create-visual-metaphor/workflow.yaml
helpers: '{project-root}/_bmad/core/resources/excalidraw/excalidraw-helpers.md'
json_validation: '{project-root}/_bmad/core/resources/excalidraw/validate-json-instructions.md'
```

**Domain-specific additions:**

```yaml
# workflows/_shared/creative-templates.yaml
rube_goldberg:
  whimsical_connector:
    type: arrow
    strokeStyle: dashed
    roughness: 2
  playful_box:
    type: rectangle
    roundness: 12
```

## What Doesn't Belong in Core

**Domain-Specific Elements:**

- Flowchart-specific templates (belongs in Frame Expert)
- Pitch deck layouts (belongs in Presentation Master)
- Documentation-specific styles (belongs in Tech Writer)

**Agent Workflows:**

- How to create a flowchart (Frame Expert workflow)
- How to create a pitch deck (Presentation Master workflow)
- Step-by-step diagram creation (agent-specific)

**Theming:**

- Currently in agent workflows
- **Future:** Will be refactored to core as user-configurable themes

## Architecture Principle

**Single Source of Truth:**

- Core holds universal knowledge
- Agents reference core, don't duplicate
- Updates to core benefit all agents
- Agents specialize with domain knowledge

**DRY (Don't Repeat Yourself):**

- Element creation logic: ONCE in core
- Text width calculation: ONCE in core
- Validation process: ONCE in core
- Arrow binding patterns: ONCE in core

## Future Enhancements

1. **External Library Loader** - Load .excalidrawlib files from libraries.excalidraw.com
2. **Theme Management** - User-configurable color themes saved in core
3. **Component Library** - Shared reusable components across agents
4. **Layout Algorithms** - Auto-layout helpers for positioning elements
