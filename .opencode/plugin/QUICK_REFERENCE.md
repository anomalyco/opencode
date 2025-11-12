# Quick Reference - Modern CLI Tools

## 🔍 File & Code Search

### fd - Fast File Finder
```bash
# Find files by name
fd config

# Find TypeScript files
fd -e ts

# Find files in specific directory
fd test src/

# Find directories only
fd -t d components

# Include hidden files
fd -H .env
```

### ripgrep - Code Search
```bash
# Search for pattern
rg "TODO"

# Search in TypeScript files only
rg "function" -t ts

# Case insensitive search
rg -i error

# Show only file names with matches
rg -l "import React"

# Search with context (3 lines before/after)
rg -C 3 "componentDidMount"
```

### ast-grep - AST Search
```bash
# Find if statements
sg -p "if ($A) { $B }"

# Find function declarations in TypeScript
sg --lang ts -p "function $F($$$)"

# Find console.log statements
sg -p "console.log($$$)"

# Find React hooks usage
sg -p "useState($$$)"
```

## 📄 File Display

### bat - Cat with Syntax
```bash
# View file with highlighting
bat file.ts

# Show specific line range
bat -r 10:20 file.ts

# Plain mode (no decorations)
bat -p file.ts

# Show line numbers (default)
bat file.ts

# Compare two files
bat file1.ts file2.ts
```

### eza - Modern ls
```bash
# Basic listing
eza

# Long format with details
eza -l

# Show all files (including hidden)
eza -a

# Tree view (2 levels deep)
eza -T -L 2

# Show git status
eza --git

# Long format with git info
eza -l --git

# Sort by modified time
eza -l --sort modified
```

## 🌐 HTTP & Data

### httpie - HTTP Client
```bash
# GET request
http GET api.example.com/users

# POST with JSON
http POST api.example.com/users name=John age:=30

# Custom headers
http GET api.example.com/users Authorization:"Bearer token"

# Download file
http --download example.com/file.pdf

# Form data
http --form POST example.com/upload file@image.png
```

### jq - JSON Processor
```bash
# Pretty print JSON
echo '{"name":"John"}' | jq .

# Extract field
echo '{"name":"John","age":30}' | jq .name

# Extract from array
echo '{"items":[{"id":1},{"id":2}]}' | jq '.items[].id'

# Select multiple fields
jq '.name, .age' data.json

# Filter array
jq '.items[] | select(.id > 1)' data.json

# Map over array
jq '.items | map(.name)' data.json
```

## 🔧 Git Tools

### delta - Git Diff Viewer
```bash
# View uncommitted changes
git diff | delta

# View staged changes
git diff --cached | delta

# View specific commit
git show HEAD | delta

# Compare branches
git diff main..feature | delta

# Configure git to use delta globally
git config --global core.pager delta
```

## 💡 Common Combinations

### Find and view files
```bash
# Find TypeScript files and view with bat
fd -e ts | xargs bat

# Search for pattern and show context
rg -C 3 "TODO" | bat -l typescript
```

### Find and edit
```bash
# Find files modified today
fd -t f --changed-within 1d

# Find large files
fd -t f --size +1m
```

### Search and replace prep
```bash
# Find all occurrences (with line numbers)
rg -n "oldFunction"

# AST-aware find (for refactoring)
sg -p "oldFunction($$$)"
```

## 📊 Performance Comparison

| Task | Old Tool | Time | New Tool | Time | Speedup |
|------|----------|------|----------|------|---------|
| Find files | `find` | 2.5s | `fd` | 0.4s | **6x** |
| Search code | `grep -r` | 15s | `rg` | 0.2s | **75x** |
| View file | `cat` | N/A | `bat` | N/A | Better UX |
| List files | `ls -la` | N/A | `eza` | N/A | Better UX |
| HTTP request | `curl` | N/A | `http` | N/A | Better UX |
| Git diff | `git diff` | N/A | `delta` | N/A | Better UX |

## 🎯 OpenCode Tool Names

When using in OpenCode sessions, reference tools by their file names:

- `fd` → File finder
- `ripgrep` → Code searcher  
- `astgrep` → AST search
- `bat` → File viewer
- `eza` → Directory listing
- `httpie` → HTTP requests
- `jq` → JSON processing
- `delta` → Git diffs

## 🔗 Official Documentation

- **fd**: https://github.com/sharkdp/fd
- **ripgrep**: https://github.com/BurntSushi/ripgrep
- **ast-grep**: https://ast-grep.github.io/
- **bat**: https://github.com/sharkdp/bat
- **eza**: https://github.com/eza-community/eza
- **httpie**: https://httpie.io/
- **jq**: https://jqlang.github.io/jq/
- **delta**: https://github.com/dandavison/delta
