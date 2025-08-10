#!/bin/bash

# Codex VIM Mode Audit Script
# This script prepares and executes a comprehensive VIM mode audit using Codex

echo "🔍 Preparing Codex VIM Mode Audit..."

# Check if codex is installed
if ! command -v codex &> /dev/null; then
    echo "❌ Codex not found. Installing..."
    npm install -g @openai/codex
fi

# Create the comprehensive prompt
cat > .codex-prompt.txt << 'EOF'
# COMPREHENSIVE VIM MODE AUDIT

## Task
Perform a thorough audit of the OpenCode CLI VIM mode implementation against the official VIM specification.

## Resources Provided
1. Full VIM motion.txt specification (attached)
2. Implementation code in packages/tui/internal/components/vim/
3. Recent bug fixes and enhancements
4. Configuration schema updates

## Audit Scope

### 1. SPECIFICATION COMPLIANCE (40% weight)
Compare implementation against VIM motion.txt:
- Motion types (inclusive vs exclusive)
- Operator behavior (doubling, counts)
- Visual mode selection semantics
- Edge case handling (EOF, empty lines, etc.)

### 2. CODE ARCHITECTURE (30% weight)
Evaluate:
- Separation of concerns
- Interface design
- State management
- Error handling
- Performance characteristics

### 3. FEATURE COMPLETENESS (20% weight)
Within chat context, assess:
- Critical missing features
- Appropriately omitted features
- Leader key implementation
- Configuration persistence

### 4. USER EXPERIENCE (10% weight)
Review:
- Status line integration
- Visual feedback
- Keybinding conflicts
- Learning curve

## Specific Analysis Required

### Motion Analysis
For each implemented motion (h,j,k,l,w,b,e,0,$,gg,G):
1. Is it inclusive or exclusive correctly?
2. Does it handle counts properly?
3. Are edge cases handled?

### Operator Analysis
For each operator (d,c,y,p,x):
1. Does doubling work correctly (dd, cc, yy)?
2. Are operator-pending states managed properly?
3. Is yanking to registers correct?

### Visual Mode Analysis
1. Character vs line selection accuracy
2. Inclusive selection adjustments
3. Visual feedback correctness

### Leader Key Analysis
1. Implementation idiomaticity
2. Timeout handling
3. Feedback mechanisms
4. Customization approach

## Output Format

### 1. Executive Summary
- Overall grade (A-F)
- Top 3 strengths
- Top 3 improvements needed

### 2. Detailed Findings
```
CATEGORY: [Spec Compliance/Architecture/Features/UX]
FINDING: [Description]
SEVERITY: [Critical/Major/Minor/Info]
RECOMMENDATION: [Action to take]
CODE LOCATION: [File:line if applicable]
```

### 3. Priority Action Items
1. Critical fixes (breaks VIM compatibility)
2. Major enhancements (important features)
3. Minor improvements (nice to have)

### 4. Code Examples
Provide corrected code for any critical issues found.

## Context
This VIM mode is for a chat prompt editor, not a full text editor. Features should enhance the prompting experience for VIM users without unnecessary complexity.

Please be thorough but pragmatic, focusing on what matters most for VIM users in this context.
EOF

echo "📋 Audit prompt prepared in .codex-prompt.txt"
echo ""
echo "🚀 Launching Codex in research mode..."
echo ""

# Execute Codex with research profile
codex --sandbox read-only \
      --model gpt-5 \
      "$(cat .codex-prompt.txt)" \
      --attach .codex-vim-audit.md \
      --attach ../../internal/components/vim/

echo ""
echo "✅ Codex audit initiated. Follow the prompts to proceed."