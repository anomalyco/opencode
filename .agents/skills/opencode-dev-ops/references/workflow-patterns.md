# Workflow Patterns: opencode-dev-ops

## TDD-Based Skill Development (How This Skill Was Created)

### RED Phase: Baseline Test (Before Skill)



### GREEN Phase: Write Skill (With Knowledge)

This skill codifies OpenCode's actual patterns:
- Branded ID types (SessionID, MessageID, etc.)
- Snake_case database columns
- Lazy-loaded route patterns
- Effect Schema for core types
- Tagged error classes
- Functional style (early returns, no else)

### REFACTOR Phase: Bulletproof

The skill now handles:
- When to use branded IDs vs newtype classes
- How to structure Drizzle schemas
- Complete API route examples
- Error handling patterns
- Permission system details

---

## Implementing a New Feature (Step-by-Step)

### Step 1: Design with brainstorming skill

Get approval on architecture and entity definitions.

### Step 2: Consult opencode-dev-ops

Check relevant sections (naming, types, database, routes, errors).

### Step 3: Implement Following Patterns

- Define branded IDs in 
- Create database table in 
- Implement service in  using Effect
- Create API routes in  with openAPI
- Add error types to 

### Step 4: Verify with Checklist



### Step 5: Use verification-before-completion Skill

Before claiming ready, verify:
- Type checking passes
- All lints pass
- Tests pass (run from package dir, not root)

---

## Common Implementation Workflows

### Adding a New Tool

1. Define input schema in  directory
2. Create Tool.Info<Params, Metadata> export
3. Implement execute() with permission checks
4. Add to tool registry
5. Test with actual execution

### Adding a Database Table

1. Create  file
2. Define table with snake_case columns
3. Add indexes following pattern
4. Create service with CRUD operations
5. Add API routes if needed

### Adding API Endpoint

1. Create route in 
2. Use lazy() initialization
3. Add describeRoute() for OpenAPI
4. Validate all inputs (param, query, json)
5. Return typed response via c.json()

### Adding Error Type

1. Create Schema.TaggedErrorClass in 
2. Add to type union (PermissionError, etc.)
3. Use throw new ErrorType({fields}) in implementations
4. Handle specifically in callers

---

## State Transitions (Session Lifecycle)

A Session moves through these states:



Tools interact with this:
- Tool permission checks read current SessionTable.permission
- Tool execution updates MessageTable via addMessage()
- Tool results create MessageV2.Part records

---

## Integration Points

### How a Request Flows



### How Tool Execution Works



### How Permissions Work




