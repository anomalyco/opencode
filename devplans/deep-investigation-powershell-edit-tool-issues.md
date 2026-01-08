# Deep Investigation: Windows Command Execution Issues - Complete Analysis

## Executive Summary

This document provides an **in-depth technical analysis** of all Windows command execution issues in the OpenCode project, with detailed investigation of the fixes needed, root cause analysis, and implementation plans.

---

## Part 1: PowerShell Execution Issues

### Issue #10: PowerShell Inline Execution - Commands Echoed But Not Executed

#### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ❌ UNFIXED |
| **Confidence** | 95% |
| **Location** | `bash.ts:276-302` |

#### Deep Investigation

**The Problem:**
When executing PowerShell commands via the Bash tool on Windows, commands are echoed but NOT executed. For example:

```bash
powershell -Command "Write-Host 'HelloWorld'"
# Expected: Outputs "HelloWorld"
# Actual: Returns "powershell -Command \"Write-Host 'HelloWorld'\"" (the command string echoed back)
```

#### Root Cause Analysis

**Step 1: Command Parsing (bash.ts:276)**

```typescript
const parsed = parseCommand(params.command)
```

For `powershell -Command "Write-Host 'HelloWorld'"`:
- `detectCommandShell()` returns `'powershell'`
- `parseCommand()` returns:
  ```typescript
  {
    executable: "powershell.exe",
    args: ["-Command", "\"Write-Host 'HelloWorld'\""],
    shouldBypassShell: false  // Uses shell wrapper
  }
  ```

**Step 2: Command Resolution (bash.ts:289-294)**

```typescript
if (parsed.shouldBypassShell && process.platform === "win32") {
  // Direct execution
  cmd = [parsed.executable, ...parsed.args]
  shellConfig = undefined
} else {
  // Shell wrapper
  const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
  cmd = shellCmd
  shellConfig = useShell ? undefined : shell
}
```

Since `shouldBypassShell: false` for PowerShell:
- Goes to ELSE branch
- `resolveWindowsCommand()` is called with:
  - `command` = `"powershell -Command \"Write-Host 'HelloWorld'\""`
  - `shell` = `"cmd.exe"`
- Returns: `{ cmd: ["cmd.exe", "/c", "powershell -Command \"Write-Host 'HelloWorld'\""], useShell: true }`

**Step 3: Execution (bash.ts:296-302)**

```typescript
const proc = Bun.spawn(cmd, {
  shell: shellConfig,  // undefined - uses default shell
  cwd,
  env: buildGitEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
})
```

**The Critical Issue:**

When `shellConfig = undefined`, Bun.spawn uses its **default shell**. On Windows, the default shell behavior is unclear - it might be using `cmd.exe` but with different argument parsing.

The command that gets executed is:
```
cmd.exe /c "powershell -Command \"Write-Host 'HelloWorld'\""
```

**The Problem:** The inner quotes are being passed **literally** to PowerShell. PowerShell receives:
```
powershell -Command "Write-Host 'HelloWorld'"
```

But with the quotes included as part of the argument value. PowerShell then treats `"Write-Host 'HelloWorld'"` as a **string literal** to echo back, not as code to execute.

#### The Smoking Gun

| Test | Command | Result |
|------|---------|--------|
| 1 | `powershell -Command "Write-Host 'HelloWorld'"` | ❌ Echoes command string |
| 2 | `powershell -ExecutionPolicy Bypass -File script.ps1` | ✅ Works correctly |
| 3 | `cmd /c powershell -Command "Write-Host 'Hello'"` | ❌ Echoes command string |

The `-File` parameter works because it reads from a file and executes the contents. The `-Command` parameter receives the string as an argument, but the way it's passed through multiple layers causes the string to be treated as literal text.

#### Fix Strategy

**Option A: Explicitly Set cmd.exe as Shell**

```typescript
// In bash.ts, around line 289-302
if (parsed.shouldBypassShell && process.platform === "win32") {
  cmd = [parsed.executable, ...parsed.args]
  shellConfig = undefined
} else if (detectCommandShell(params.command) === 'powershell' || 
           detectCommandShell(params.command) === 'pwsh') {
  // PowerShell: Use explicit cmd.exe with proper argument handling
  const parts = params.command.split(/\s+/)
  const psArgs = parts.slice(1) // Skip 'powershell' or 'pwsh'
  cmd = ["cmd.exe", "/c", "powershell", ...psArgs]
  shellConfig = undefined
} else {
  const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
  cmd = shellCmd
  shellConfig = useShell ? undefined : shell
}
```

**Option B: Use -File Parameter with Auto-Wrapping**

For simple commands, auto-wrap into a temp PS1 file:

```typescript
if (detectCommandShell(params.command) === 'powershell') {
  // Extract the -Command argument
  const commandMatch = params.command.match(/-Command\s+"([^"]*)"/)
  if (commandMatch) {
    const scriptContent = commandMatch[1]
    const tempFile = Bun.file(TempDir + "/temp-" + Date.now() + ".ps1")
    await tempFile.write(scriptContent)
    cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", tempFile.path]
    shellConfig = undefined
  }
}
```

**Option C: Direct PowerShell Execution (Recommended)**

```typescript
if (detectCommandShell(params.command) === 'powershell') {
  // Extract executable and args
  const parts = params.command.trim().split(/\s+/)
  const executable = parts[0] // 'powershell' or 'powershell.exe'
  const args = parts.slice(1)
  
  // Use -Command with proper escaping
  cmd = [executable, ...args]
  shellConfig = undefined // No shell wrapper
} else if (parsed.shouldBypassShell && process.platform === "win32") {
  cmd = [parsed.executable, ...parsed.args]
  shellConfig = undefined
} else {
  const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
  cmd = shellCmd
  shellConfig = useShell ? undefined : shell
}
```

#### Recommended Fix Implementation

**File: `packages/opencode/src/tool/bash.ts`**

Replace the command resolution section (lines 280-302) with:

```typescript
// Resolve command for Windows compatibility
const parsed = parseCommand(params.command)
const shellType = detectCommandShell(params.command)
let cmd: string[]
let shellConfig: string | undefined

if (process.platform === "win32") {
  // Windows-specific command handling
  if (shellType === 'powershell' || shellType === 'pwsh') {
    // PowerShell: Extract executable and arguments
    const parts = params.command.trim().split(/\s+/)
    const executable = shellType === 'pwsh' ? 'pwsh' : 'powershell.exe'
    const args = parts.slice(1)
    
    log.info("PowerShell execution", {
      command: params.command,
      executable,
      args
    })
    
    cmd = [executable, ...args]
    shellConfig = undefined // Direct execution, no shell wrapper
    
  } else if (shellType === 'cmd') {
    // CMD: Direct execution
    cmd = [parsed.executable, ...parsed.args]
    shellConfig = undefined
    
  } else if (parsed.shouldBypassShell) {
    // Other commands that should bypass shell
    cmd = [parsed.executable, ...parsed.args]
    shellConfig = undefined
    
  } else {
    // Use shell wrapper for other commands
    const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
    cmd = shellCmd
    shellConfig = useShell ? undefined : shell
  }
} else {
  // Non-Windows: Original logic
  if (parsed.shouldBypassShell) {
    cmd = [parsed.executable, ...parsed.args]
    shellConfig = undefined
  } else {
    const { cmd: shellCmd, useShell } = resolveWindowsCommand(params.command, shell)
    cmd = shellCmd
    shellConfig = useShell ? undefined : shell
  }
}
```

#### Test Cases

```typescript
describe("PowerShell execution fixes", () => {
  test("executes Write-Host command", async () => {
    if (process.platform !== "win32") return
    
    const result = await bash.execute({
      command: 'powershell -Command "Write-Host HelloWorld"',
      description: "Test PowerShell output",
    }, ctx)
    
    expect(result.metadata.exit).toBe(0)
    expect(result.metadata.output).toContain("HelloWorld")
  })
  
  test("executes Get-Date command", async () => {
    if (process.platform !== "win32") return
    
    const result = await bash.execute({
      command: 'powershell -Command "Get-Date"',
      description: "Test Get-Date",
    }, ctx)
    
    expect(result.metadata.exit).toBe(0)
    expect(result.metadata.output).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/) // Date format
  })
  
  test("executes multi-line script block", async () => {
    if (process.platform !== "win32") return
    
    const result = await bash.execute({
      command: 'powershell -Command "$a = 5; $a * 3"',
      description: "Test script block",
    }, ctx)
    
    expect(result.metadata.exit).toBe(0)
    expect(result.metadata.output).toContain("15")
  })
})
```

---

## Part 2: Edit Tool Issues

### Issue #7: newString Parameter Validation

#### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | CRITICAL |
| **Status** | ❌ UNFIXED |
| **Confidence** | 100% |
| **Location** | `edit.ts:33-40` |

#### Error Message
```
Error: The edit tool was called with invalid arguments: [
  {
    "expected": "string",
    "code": "invalid_type",
    "path": ["newString"],
    "message": "Invalid input: expected string, received undefined"
  }
]
```

#### Root Cause Analysis

The issue occurs at the **Zod validation layer** before `execute()` is called. Looking at `edit.ts:27-32`:

```typescript
parameters: z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
}),
```

The schema correctly defines `newString` as required. The error comes from:
1. **Tool invocation layer** not passing `newString` parameter correctly
2. **Multi-line strings** not being serialized properly in JSON
3. **Unicode characters** in newString causing parsing issues

#### Investigation: Where the Bug Occurs

The error is a **Zod validation error**, which means it happens in the tool definition layer, not in `execute()`. This suggests the issue is in:

1. **How the tool is called from the agent/UI layer**
2. **How JSON is serialized/deserialized for tool calls**
3. **How multi-line strings are passed through the system**

#### Fix Implementation

**Option A: Add validation guard in execute()**

```typescript
async execute(params, ctx) {
  // FIX #7: Add newString validation guard
  if (params.newString === undefined || params.newString === null) {
    throw new Error(
      "newString parameter is required but was undefined. " +
      "This may indicate a serialization issue in the tool invocation layer. " +
      "Ensure newString is properly passed as a string value."
    )
  }
  
  // Ensure newString is a string (handles edge cases)
  const safeNewString = params.newString === null ? "" : String(params.newString)
  
  // Normalize line endings
  const normalizedNewString = safeNewString
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
  
  // Log for debugging
  console.log("[EDIT-TOOL] Called with:", {
    filePath: params.filePath,
    oldStringLength: params.oldString?.length ?? 0,
    newStringLength: normalizedNewString.length,
    hasNewString: normalizedNewString.length > 0,
    firstChars: normalizedNewString.substring(0, 50).replace(/\n/g, "\\n"),
  })
  
  // ... rest of execute
}
```

**Option B: Add Zod preprocessing**

```typescript
parameters: z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z
    .string()
    .transform((val) => (val === undefined ? null : val))
    .refine((val) => val !== null, {
      message: "newString is required",
    })
    .describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
}),
```

**Recommended: Option A with logging**

---

### Issue #15: Edit Tool Multiple Matches Error

#### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ❌ UNFIXED |
| **Confidence** | 90% |
| **Location** | `edit.ts:618-654` |

#### Problem Statement

Pattern `Username\n\n — Date Time` appears ~1100 times in the codebase. When trying to edit one occurrence:

```typescript
edit({
  filePath: "file.md",
  oldString: "Username\n\n — Date Time",
  newString: "NewUsername\n\n — New Date Time",
})
```

**Error:** "Found multiple matches for oldString. Provide more surrounding lines..."

#### Current Logic Analysis

```typescript
// edit.ts:618-654
export function replace(content: string, oldString: string, newString: string, replaceAll = false): string {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  let notFound = true

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue  // <-- PROBLEM: Skips if multiple matches
      return content.substring(0, index) + newString + content.substring(index + search.length)
    }
  }

  if (notFound) {
    throw new Error("oldString not found in content")
  }
  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match.",
  )
}
```

**The Problem:**
1. When `replaceAll = false` and multiple matches exist, the code continues to the next replacer
2. If ALL replacers find multiple matches, it throws an error
3. There's no way to replace just the **first** occurrence

#### Fix Implementation

**Add `replaceFirst` parameter:**

```typescript
export function replace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
  replaceFirst = false,  // ADD THIS
): string {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different")
  }

  let notFound = true
  let firstMatchIndex = -1
  let firstMatchLength = 0

  // First pass: find all matches
  const matches: Array<{ search: string; index: number; length: number }> = []

  for (const replacer of [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
  ]) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      
      notFound = false
      matches.push({ search, index, length: search.length })
      
      // Record first match for replaceFirst mode
      if (replaceFirst && firstMatchIndex === -1) {
        firstMatchIndex = index
        firstMatchLength = search.length
      }
      
      if (!replaceAll && !replaceFirst) {
        const lastIndex = content.lastIndexOf(search)
        if (index !== lastIndex) continue  // Multiple matches, skip
        return content.substring(0, index) + newString + content.substring(index + search.length)
      }
    }
  }

  // Handle replaceFirst mode
  if (replaceFirst && firstMatchIndex !== -1) {
    return content.substring(0, firstMatchIndex) + 
           newString + 
           content.substring(firstMatchIndex + firstMatchLength)
  }

  // Handle replaceAll mode
  if (replaceAll && matches.length > 0) {
    // Replace from end to avoid index shifting
    let result = content
    for (const match of matches.sort((a, b) => b.index - a.index)) {
      result = result.substring(0, match.index) + 
               newString + 
               result.substring(match.index + match.length)
    }
    return result
  }

  // Fallback to MultiOccurrenceReplacer
  if (replaceAll || replaceFirst) {
    for (const search of MultiOccurrenceReplacer(content, oldString)) {
      if (replaceAll) {
        return content.replaceAll(search, newString)
      }
      if (replaceFirst) {
        const idx = content.indexOf(search)
        if (idx !== -1) {
          return content.substring(0, idx) + 
                 newString + 
                 content.substring(idx + search.length)
        }
      }
    }
  }

  if (notFound) {
    throw new Error("oldString not found in content")
  }
  throw new Error(
    "Found multiple matches for oldString. " +
    "Provide more surrounding lines in oldString or use replaceFirst parameter."
  )
}
```

**Update tool schema:**

```typescript
parameters: z.object({
  filePath: z.string().describe("The absolute path to the file to modify"),
  oldString: z.string().describe("The text to replace"),
  newString: z.string().describe("The text to replace it with (must be different from oldString)"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
  replaceFirst: z.boolean().optional().describe("Replace only the first occurrence (default false)"),
}),
```

---

### Issue #19: Edit Tool Unicode Character Matching

#### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | HIGH |
| **Status** | ❌ UNFIXED |
| **Confidence** | 85% |
| **Location** | `edit.ts:184-482` |

#### Problematic Characters

| Character Type | Example | Unicode | Failure |
|----------------|---------|---------|---------|
| Smart quotes | " vs " | U+201C/U+201D vs U+0022 | ❌ Mismatch |
| Em dash | — vs - | U+2014 vs U+002D | ❌ Mismatch |
| Smart apostrophe | ' vs ' | U+2019 vs U+0027 | ❌ Mismatch |
| Ellipsis | … vs ... | U+2026 vs U+002E | ❌ Mismatch |

#### Root Cause Analysis

All replacers use **simple JavaScript string operations**:

```typescript
// SimpleReplacer
if (content.includes(unescapedFind)) { ... }

// LineTrimmedReplacer
if (originalTrimmed !== searchTrimmed) { ... }

// All comparisons use strict equality (===)
```

**Unicode normalization issue:** JavaScript strings are UTF-16. Smart quotes and regular quotes have different code points but may look identical to humans.

#### Fix Implementation

**Add UnicodeNormalizedReplacer:**

```typescript
// FIX #19: Add UnicodeNormalizedReplacer
export const UnicodeNormalizedReplacer: Replacer = function* (content, find) {
  // Character mapping: smart characters → regular characters
  const smartCharMap: Record<string, string> = {
    // Smart double quotes → regular quote
    '\u201C': '"',  // "
    '\u201D': '"',  // "
    '\u201E': '"',  // ,,
    '\u201F': '"',  // ,,
    // Smart single quotes → regular apostrophe
    '\u2018': "'",  // '
    '\u2019': "'",  // '
    '\u201A': "'",  // ,,
    '\u201B': "'",  // ,,
    // Dashes
    '\u2014': '-',  // Em dash
    '\u2013': '-',  // En dash
    '\u2212': '-',  // Minus sign
    // Ellipsis
    '\u2026': '...',
    // Other
    '\u00A0': ' ',  // Non-breaking space
  }

  const cleanString = (str: string): string => {
    let result = str
    for (const [smart, regular] of Object.entries(smartCharMap)) {
      result = result.replace(new RegExp(smart, 'g'), regular)
    }
    return result
  }

  const normalizedContent = cleanString(content)
  const normalizedFind = cleanString(find)

  // Try exact normalized match first
  if (normalizedContent.includes(normalizedFind)) {
    // Find all positions where normalized strings match
    const positions: number[] = []
    let pos = 0
    while (pos < content.length) {
      const chunk = cleanString(content.substring(pos, Math.min(pos + normalizedFind.length + 10, content.length)))
      if (chunk.startsWith(normalizedFind)) {
        positions.push(pos)
      }
      pos++
    }

    for (const startPos of positions) {
      yield content.substring(startPos, startPos + normalizedFind.length)
    }
    return
  }

  // Try fuzzy line-by-line matching
  const contentLines = content.split("\n")
  const findLines = normalizedFind.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    let allMatch = true
    for (let j = 0; j < findLines.length; j++) {
      if (cleanString(contentLines[i + j]) !== findLines[j]) {
        allMatch = false
        break
      }
    }
    if (allMatch) {
      yield contentLines.slice(i, i + findLines.length).join("\n")
    }
  }
}
```

**Add to replacer chain:**

```typescript
for (const replacer of [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  UnicodeNormalizedReplacer,  // ADD THIS
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  EscapeNormalizedReplacer,
  TrimmedBoundaryReplacer,
  ContextAwareReplacer,
]) {
```

---

### Issue #26: Edit Tool Multi-line Patterns with Empty Lines

#### Current Status
| Aspect | Finding |
|--------|---------|
| **Severity** | MEDIUM |
| **Status** | ❌ UNFIXED |
| **Confidence** | 80% |
| **Location** | `edit.ts:228-361` |

#### Problem

Cannot match patterns with empty lines between content:
```
"Username\n\n — Yesterday at 3:28 PM"
```

**Error:** "oldString not found in content"

#### Root Cause Analysis

**BlockAnchorReplacer** (lines 228-361):

1. **Line 232-234:** Requires at least 3 lines to be a valid block
   ```typescript
   if (searchLines.length < 3) {
     return  // Empty lines patterns with 2 lines fail here!
   }
   ```

2. **Line 252:** Looks for last line at `j = i + 2`, skipping single empty lines
   ```typescript
   for (let j = i + 2; j < originalLines.length; j++) {  // Skips j = i+1 (empty line)
   ```

#### Fix Implementation

**Option A: Fix BlockAnchorReplacer**

```typescript
// FIX #26: Reduce minimum lines requirement
// OLD (line 232-234):
if (searchLines.length < 3) {
  return
}

// NEW:
if (searchLines.length < 2) {
  return
}
```

```typescript
// FIX #26: Allow variable gap for empty lines
// OLD (line 252):
for (let j = i + 2; j < originalLines.length; j++) {

// NEW:
for (let j = i + 1; j < originalLines.length; j++) {
  // Skip consecutive empty lines when looking for last anchor
  let skipCount = 0
  while (j + skipCount < originalLines.length && 
         originalLines[j + skipCount].trim() === "" && 
         skipCount < 2) {
    skipCount++
  }
  const actualJ = j + skipCount
  if (actualJ >= originalLines.length) break
  if (originalLines[actualJ].trim() === lastLineSearch) {
    candidates.push({ startLine: i, endLine: actualJ })
    break
  }
  j = actualJ  // Continue from after empty lines
}
```

**Option B: Add EmptyLineTolerantReplacer**

```typescript
// FIX #26: Add EmptyLineTolerantReplacer for patterns with empty lines
export const EmptyLineTolerantReplacer: Replacer = function* (content, find) {
  const findLines = find.split("\n")

  // Check if this is a pattern with empty lines
  const hasEmptyLine = findLines.some(line => line.trim() === "")
  if (!hasEmptyLine) {
    return  // Not a pattern with empty lines, skip
  }

  const contentLines = content.split("\n")

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    let matches = true

    for (let j = 0; j < findLines.length; j++) {
      const findLine = findLines[j].trim()
      const contentLine = contentLines[i + j].trim()

      // Empty lines in find pattern match any empty-ish content line
      if (findLine === "") {
        // Accept empty line or line with only whitespace
        if (contentLine !== "") {
          matches = false
          break
        }
      } else if (findLine !== contentLine) {
        matches = false
        break
      }
    }

    if (matches) {
      yield contentLines.slice(i, i + findLines.length).join("\n")
      return  // Only return first match
    }
  }
}
```

**Add to replacer chain:**

```typescript
for (const replacer of [
  SimpleReplacer,
  LineTrimmedReplacer,
  BlockAnchorReplacer,
  UnicodeNormalizedReplacer,
  WhitespaceNormalizedReplacer,
  EmptyLineTolerantReplacer,  // ADD THIS
  IndentationFlexibleReplacer,
  // ...
]) {
```

---

## Part 3: Test Inconsistency Analysis

### Critical Finding: Test Mismatch

| File | Line | Expected `shouldBypassShell` | Actual Value |
|------|------|------------------------------|--------------|
| `bash.ts` | 148 | N/A | `false` (uses shell wrapper) |
| `bash.test.ts` | 44 | `true` (WRONG!) | N/A |
| `bash-windows.test.ts` | 39 | `false` (CORRECT) | N/A |

#### Analysis

The **Unix test** (`bash.test.ts`) expects `shouldBypassShell: true` for PowerShell commands, but:
1. The **code** sets `shouldBypassShell: false` (uses shell wrapper)
2. The **Windows test** expects `shouldBypassShell: false`

**Conclusion:** The Unix test is **outdated** and needs to be updated.

#### Fix: Update Unix Test

**File: `packages/opencode/test/tool/bash.test.ts`**

```typescript
// REMOVE this test (it's PowerShell-specific and doesn't belong in Unix tests):
// it("should bypass shell for powershell.exe commands", () => {
//   const result = parseCommand("powershell.exe -Command Get-Process")
//   expect(result.shouldBypassShell).toBe(true)
//   ...
// })
```

Or update it to match the new behavior:

```typescript
it("should use shell wrapper for powershell.exe commands", () => {
  const result = parseCommand("powershell.exe -Command Get-Process")
  expect(result.shouldBypassShell).toBe(false)  // Fixed: was true
  expect(result.executable).toBe("powershell.exe")
  expect(result.args).toEqual(["-Command", "Get-Process"])
})
```

---

## Part 4: Implementation Priority Matrix

### Priority 1: Critical (Must Fix)

| Issue | Fix | Effort | Confidence |
|-------|-----|--------|------------|
| #7 | Add newString validation | Medium | 100% |
| #10 | Fix PowerShell execution | High | 95% |
| #15 | Add replaceFirst mode | Medium | 90% |

### Priority 2: High

| Issue | Fix | Effort | Confidence |
|-------|-----|--------|------------|
| #19 | Add UnicodeNormalizedReplacer | Medium | 85% |
| #26 | Fix empty line patterns | Medium | 80% |

### Priority 3: Medium

| Issue | Fix | Effort | Confidence |
|-------|-----|--------|------------|
| #13 | Fix test inconsistency | Low | 90% |
| #14 | Fix script block handling | Medium | 90% |

---

## Part 5: Files to Modify

### `packages/opencode/src/tool/bash.ts`

| Lines | Change |
|-------|--------|
| 276-302 | Replace command resolution logic for PowerShell |
| 108-127 | Update detectCommandShell() if needed |
| 133-169 | Update parseCommand() if needed |

### `packages/opencode/src/tool/edit.ts`

| Lines | Change |
|-------|--------|
| 33-40 | Add newString validation guard |
| 435-482 | Add UnicodeNormalizedReplacer |
| 228-361 | Fix BlockAnchorReplacer for empty lines |
| 618-655 | Add replaceFirst parameter to replace() |
| 27-32 | Update schema with replaceFirst |

### `packages/opencode/test/tool/bash.test.ts`

| Lines | Change |
|-------|--------|
| 42-47 | Update or remove PowerShell test |

---

## Conclusion

This deep investigation reveals:

1. **PowerShell execution is broken** due to how arguments are passed through multiple shell layers
2. **Edit tool has multiple issues** with validation, Unicode, and multi-line patterns
3. **Tests are inconsistent** between Unix and Windows platforms

The fixes are well-understood and documented above. Implementation should follow the priority matrix to address the most critical issues first.
