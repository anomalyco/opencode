# JSON Validation Instructions

## Purpose

Validate Excalidraw JSON files after saving to catch syntax errors (missing commas, brackets, quotes).

## How to Validate

Use Node.js built-in JSON parsing to validate the file:

```bash
node -e "JSON.parse(require('fs').readFileSync('FILE_PATH', 'utf8')); console.log('✓ Valid JSON')"
```

Replace `FILE_PATH` with the actual file path.

## Exit Codes

- Exit code 0 = Valid JSON
- Exit code 1 = Invalid JSON (syntax error)

## Error Output

If invalid, Node.js will output:

- Error message with description
- Position in file where error occurred
- Line and column information (if available)

## Common Errors and Fixes

### Missing Comma

```
SyntaxError: Expected ',' or '}' after property value
```

**Fix:** Add comma after the property value

### Missing Bracket/Brace

```
SyntaxError: Unexpected end of JSON input
```

**Fix:** Add missing closing bracket `]` or brace `}`

### Extra Comma (Trailing)

```
SyntaxError: Unexpected token ,
```

**Fix:** Remove the trailing comma before `]` or `}`

### Missing Quote

```
SyntaxError: Unexpected token
```

**Fix:** Add missing quote around string value

## Workflow Integration

After saving an Excalidraw file, run validation:

1. Save the file
2. Run: `node -e "JSON.parse(require('fs').readFileSync('{{save_location}}', 'utf8')); console.log('✓ Valid JSON')"`
3. If validation fails:
   - Read the error message for line/position
   - Open the file at that location
   - Fix the syntax error
   - Save and re-validate
4. Repeat until validation passes

## Critical Rule

**NEVER delete the file due to validation errors - always fix the syntax error at the reported location.**
