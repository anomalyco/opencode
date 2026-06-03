---
id: analyze-patterns
name: analyze-patterns
description: "Analyze codebase for patterns and similar implementations"
type: command
category: analysis
version: 1.0.0
---

# Command: analyze-patterns

## Description

Analyze codebase for recurring patterns, similar implementations, and refactoring opportunities. Replaces codebase-pattern-analyst subagent functionality with a command-based interface.

## Usage

```bash
/analyze-patterns [--pattern=<pattern>] [--language=<lang>] [--depth=<level>] [--output=<format>]
```

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--pattern` | string | No | Pattern name or regex to search for (e.g., "singleton", "factory", "error-handling") |
| `--language` | string | No | Filter by language: js, ts, py, go, rust, java, etc. |
| `--depth` | string | No | Search depth: shallow (current dir) \| medium (src/) \| deep (entire repo) |
| `--output` | string | No | Output format: text (default) \| json \| markdown |

## Behavior

### Pattern Search
- Searches codebase for pattern matches using regex + semantic analysis
- Identifies similar implementations across files
- Groups results by pattern type + similarity score
- Suggests refactoring opportunities

### Analysis Output
- Pattern occurrences with file locations + line numbers
- Similarity metrics (how similar are implementations?)
- Refactoring suggestions (consolidate, extract, standardize)
- Code quality insights (duplication, inconsistency)

### Result Format
```
Pattern Analysis Report
=======================

Pattern: [pattern_name]
Occurrences: [count]
Files: [file_list]

Implementations:
  1. [file:line] - [description] (similarity: X%)
  2. [file:line] - [description] (similarity: Y%)
  ...

Refactoring Suggestions:
  - [suggestion 1]
  - [suggestion 2]
  ...

Quality Insights:
  - [insight 1]
  - [insight 2]
  ...
```

## Examples

### Find all error handling patterns
```bash
/analyze-patterns --pattern="error-handling" --language=ts
```

### Analyze factory patterns across codebase
```bash
/analyze-patterns --pattern="factory" --depth=deep --output=json
```

### Find similar API endpoint implementations
```bash
/analyze-patterns --pattern="api-endpoint" --language=js --output=markdown
```

### Search for singleton patterns
```bash
/analyze-patterns --pattern="singleton" --depth=medium
```

## Implementation

### Delegation
- Delegates to: **opencoder** (primary)
- Uses context search capabilities for pattern matching
- Returns structured pattern analysis results

### Context Requirements
- Codebase structure + file organization
- Language-specific patterns + conventions
- Project-specific naming conventions
- Existing refactoring guidelines

### Processing Steps
1. Parse command parameters
2. Validate pattern syntax (regex or predefined)
3. Search codebase using glob + grep tools
4. Analyze semantic similarity of matches
5. Group results by pattern + similarity
6. Generate refactoring suggestions
7. Format output per requested format
8. Return analysis report

## Predefined Patterns

### JavaScript/TypeScript
- `singleton` - Singleton pattern implementations
- `factory` - Factory pattern implementations
- `observer` - Observer/event pattern implementations
- `error-handling` - Error handling patterns
- `async-patterns` - Promise/async-await patterns
- `api-endpoint` - API endpoint definitions
- `middleware` - Middleware implementations

### Python
- `decorator` - Decorator pattern implementations
- `context-manager` - Context manager patterns
- `error-handling` - Exception handling patterns
- `async-patterns` - Async/await patterns
- `class-patterns` - Class design patterns

### Go
- `interface-patterns` - Interface implementations
- `error-handling` - Error handling patterns
- `goroutine-patterns` - Goroutine patterns
- `middleware` - Middleware implementations

### Custom Patterns
Users can provide custom regex patterns for domain-specific analysis.

## Output Formats

### Text (Default)
Human-readable report with clear sections and formatting

### JSON
Structured data for programmatic processing:
```json
{
  "pattern": "error-handling",
  "occurrences": 12,
  "files": ["file1.ts", "file2.ts"],
  "implementations": [
    {
      "file": "file1.ts",
      "line": 42,
      "description": "try-catch block",
      "similarity": 0.95
    }
  ],
  "suggestions": ["Consolidate error handling", "Extract to utility"]
}
```

### Markdown
Formatted for documentation + sharing:
```markdown
# Pattern Analysis: error-handling

**Occurrences**: 12  
**Files**: 3  
**Similarity Range**: 85-98%

## Implementations
...
```

## Integration

### Registry Entry
```json
{
  "id": "analyze-patterns",
  "name": "analyze-patterns",
  "type": "command",
  "category": "analysis",
  "description": "Analyze codebase for patterns and similar implementations",
  "delegates_to": ["opencoder"],
  "parameters": ["pattern", "language", "depth", "output"]
}
```

### Profile Assignment
- **Developer Profile**: ✅ Included
- **Full Profile**: ✅ Included
- **Advanced Profile**: ✅ Included
- **Business Profile**: ❌ Not included

## Notes

- Replaces `codebase-pattern-analyst` subagent functionality
- Command-based interface is more flexible + discoverable
- Supports both predefined + custom patterns
- Results can be exported for documentation
- Integrates with refactoring workflows

---

## Validation Checklist

✅ Command structure defined  
✅ Parameters documented  
✅ Behavior specified  
✅ Examples provided  
✅ Implementation details included  
✅ Output formats defined  
✅ Integration ready  
✅ Ready for registry integration  

**Status**: Ready for deployment
