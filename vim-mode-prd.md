# Product Requirements Document: Vim Mode for OpenCode

## Executive Summary

This PRD outlines the implementation of a focused Vim mode for OpenCode's prompt input area, providing modal editing capabilities optimized for composing AI prompts. The implementation will leverage Go and the Bubble Tea framework while maintaining OpenCode's design principles as an agentic coding tool.

## Background & Motivation

### Current State
- OpenCode uses a custom textarea component for prompt composition
- Users type natural language prompts to interact with AI
- The TUI is built with Go using the Bubble Tea framework
- Input handling is managed through a centralized event system

### User Need
- Power users want efficient prompt editing without leaving home row
- Quick text manipulation for refining prompts before submission
- Vim motions for rapid navigation within multi-line prompts
- Muscle memory from text editors transfers to prompt composition

## Technical Architecture

### Core Components

#### 1. Mode Manager
```go
type VimMode int

const (
    ModeNormal VimMode = iota
    ModeInsert
    ModeVisual
    ModeVisualLine
    ModeReplace
)

type VimModeManager struct {
    currentMode     VimMode
    previousMode    VimMode
    enabled         bool
    pendingCount    string  // For multi-digit counts (e.g., "12j")
    pendingOperator string  // For operators awaiting motion (e.g., "d", "c", "y")
    visualStart     Position
    visualEnd       Position
    lastChange      Change  // For dot repeat
    registers       map[string]string
}
```

#### 2. Motion Engine
```go
type Motion struct {
    Type      MotionType
    Count     int
    Inclusive bool  // For operator-pending mode
}

type MotionType int

const (
    MotionChar MotionType = iota
    MotionWord
    MotionLine
    MotionParagraph
    MotionSentence
    MotionSearch
    // ... more motion types
)

type MotionEngine interface {
    ExecuteMotion(buffer [][]any, cursor Position, motion Motion) Position
    GetTextObject(buffer [][]any, cursor Position, object TextObject) TextRange
}
```

#### 3. Command Parser
```go
type VimCommand struct {
    Count    int
    Operator string
    Motion   Motion
    Register string
}

type CommandParser struct {
    pendingKeys []string
    timeout     time.Duration
}

func (p *CommandParser) ParseKeys(keys []string) (*VimCommand, bool)
```

### Integration Points

#### 1. Textarea Component Extension
```go
// Extend the existing textarea.Model
type VimTextarea struct {
    textarea.Model
    vimMode      *VimModeManager
    motionEngine MotionEngine
    parser       *CommandParser
}

// Override Update method to intercept key events
func (m *VimTextarea) Update(msg tea.Msg) (tea.Model, tea.Cmd)
```

#### 2. Keybinding System Integration
- Vim mode will intercept keys before the standard keybinding system
- When disabled, keys pass through to normal OpenCode keybindings
- Leader key combinations remain accessible in Normal mode

#### 3. Status Line Integration
- Display current mode in status line
- Show pending commands and counts
- Visual feedback for operator-pending state

## Feature Specification

### Modal Editing

#### Normal Mode
- **Movement**: h, j, k, l, w, b, e, 0, ^, $, gg, G
- **Search**: /, ? for forward/backward search, n/N for next/previous match
- **Operators**: d, c, y, p, P, x, X, r
- **Text Objects**: iw, aw, i", a", i', a', i(, a(, i{, a{, i[, a[
- **Counts**: All movements and operators support numeric counts
- **Undo/Redo**: u, Ctrl-r
- **Quick edits**: A (append at end), I (insert at beginning), o/O (new line)

#### Insert Mode
- All standard typing functionality
- Escape returns to Normal mode
- Ctrl-w for word deletion
- Ctrl-u for line deletion from cursor
- Preserves OpenCode's attachment handling

#### Visual Mode
- Character-wise: v
- Line-wise: V
- All motion commands work for selection
- Operators apply to selection
- Easy copy/paste for prompt refinement

### Core Features

#### 1. Search
- / for forward search, ? for backward search
- n/N for navigating between matches
- Search highlighting with clear visual feedback
- Incremental search as you type

#### 2. Registers
- Unnamed register for quick operations
- System clipboard integration (*, +)
- Named registers (a-z) for storing text
- Preserves yanked text across mode switches

#### 3. Dot Repeat
- . repeats last change
- Intelligent tracking of compound operations
- Includes count in repeat

#### 4. Text Objects
- Word-based: iw (inner word), aw (around word)
- Quote-based: i"/i' (inner quotes), a"/a' (around quotes)
- Bracket-based: i(, i{, i[ with their around variants

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1)
1. Implement VimModeManager with Normal/Insert modes
2. Create mode switching mechanism
3. Integrate with textarea component
4. Add mode indicator to status line

### Phase 2: Basic Motions & Operators (Week 2-3)
1. Character motions (h, j, k, l)
2. Word motions (w, b, e)
3. Line motions (0, ^, $)
4. Document motions (gg, G)
5. Delete, change, yank operators
6. Numeric count support

### Phase 3: Search & Visual Mode (Week 4)
1. Implement search (/, ?, n, N)
2. Search highlighting
3. Character-wise visual mode
4. Line-wise visual mode
5. Visual mode operators

### Phase 4: Text Objects & Registers (Week 5)
1. Implement text objects (words, quotes, brackets)
2. Basic register system
3. System clipboard integration
4. Dot repeat functionality
5. Undo/redo integration

### Phase 5: Polish & Testing (Week 6)
1. Configuration options
2. Performance optimization
3. Edge case handling
4. Comprehensive testing

## Configuration

### User Settings
```json
{
  "vim": {
    "enabled": true
  }
}
```

### Toggle Mechanism
- Single setting: enabled/disabled
- Keybinding: `Ctrl-Alt-v` to toggle Vim mode
- OpenCode command: Available through command palette
- Persistent preference saved in user config
- Visual indicator in status line when enabled

## Testing Strategy

### Unit Tests
- Motion calculations
- Command parsing
- Register operations
- Undo/redo functionality

### Integration Tests
- Mode transitions
- Complex command sequences
- Visual selection operations
- Attachment preservation

### User Acceptance Tests
- Common Vim workflows for text editing
- Performance with multi-line prompts
- Compatibility with existing OpenCode features
- Clipboard integration across platforms

## Performance Considerations

### Optimizations
1. Lazy evaluation of motions
2. Efficient text object calculations
3. Minimal re-rendering during operations
4. Smart caching for repeated motions

### Benchmarks
- Target: <1ms for basic motions
- Target: <10ms for complex operations
- Memory overhead: <1MB for Vim state

## Success Metrics

1. **Adoption Rate**: 30% of power users enable Vim mode
2. **Performance**: All operations complete in <10ms
3. **Compatibility**: 100% of standard Vim motions supported
4. **User Satisfaction**: >4.5/5 rating from Vim users

## Risk Mitigation

### Technical Risks
1. **Terminal Compatibility**: Some key combinations may not work
   - Mitigation: Provide alternative mappings
2. **Performance Impact**: Complex motions might be slow
   - Mitigation: Implement motion caching
3. **Conflict with Existing Keys**: Vim keys might override OpenCode shortcuts
   - Mitigation: Clear mode indication and easy toggle

### User Experience Risks
1. **Learning Curve**: Non-Vim users might enable accidentally
   - Mitigation: Clear onboarding and easy disable
2. **Feature Discovery**: Users might not know all capabilities
   - Mitigation: Built-in help system and cheat sheet

## Future Enhancements

1. **Macro Recording**: q{register} to record, @{register} to replay
2. **Block Visual Mode**: Ctrl-v for column selection
3. **More Text Objects**: Sentence (is/as), paragraph (ip/ap)
4. **Custom Keybindings**: Allow users to remap keys
5. **Jump Motions**: f/F/t/T for character jumps within line

## Conclusion

This focused Vim mode implementation brings the efficiency of modal editing to OpenCode's prompt composition, allowing developers to leverage their muscle memory while interacting with AI. By focusing on the core editing operations that matter for prompt refinement, we deliver maximum value without unnecessary complexity. The 6-week implementation timeline ensures a robust, well-tested feature that enhances the OpenCode experience for power users.