package vim

import (
	"regexp"
	"strconv"
	"strings"
)

// CommandType represents the type of Vim command
type CommandType int

const (
	CommandMotion CommandType = iota
	CommandOperator
	CommandInsert
	CommandVisual
	CommandDotRepeat
	CommandUndo
	CommandRedo
	CommandPaste
	CommandRegister
	CommandSearch
	CommandOther
	
	// Aliases for test compatibility
	CommandDelete    = CommandOperator
	CommandChange    = CommandOperator
	CommandYank      = CommandOperator
	CommandPut       = CommandPaste
	CommandPutBefore = CommandPaste
	CommandRepeat    = CommandDotRepeat
	CommandSubstitute = CommandOperator
)

// VimCommand represents a parsed Vim command
type VimCommand struct {
	Type     CommandType
	Count    int
	Operator string
	Motion   *Motion
	Register string
	Text     string // For search patterns or inserted text
}

// Command is an alias for VimCommand (for test compatibility)
type Command = VimCommand

// CommandParser parses key sequences into Vim commands
type CommandParser struct {
	motionEngine *MotionEngine
}

// NewCommandParser creates a new command parser
func NewCommandParser() *CommandParser {
	return &CommandParser{
		motionEngine: NewMotionEngine(),
	}
}

// ParseMotion parses a motion command (for tests)
func (p *CommandParser) ParseMotion(input string, count int) (*Motion, string) {
	if len(input) == 0 {
		return nil, ""
	}
	
	// Handle two-character motions
	if len(input) >= 2 {
		twoChar := input[:2]
		if twoChar == "gg" {
			return &Motion{Type: MotionFileStart, Count: count, Direction: -1}, input[2:]
		} else if twoChar == "iw" {
			return &Motion{Type: MotionInnerWord, Count: count, Inclusive: true}, input[2:]
		} else if twoChar == "aw" {
			return &Motion{Type: MotionAroundWord, Count: count, Inclusive: true}, input[2:]
		} else if twoChar == "i\"" {
			return &Motion{Type: MotionInnerQuotes, Count: count, Inclusive: true}, input[2:]
		}
		
		// Handle f/F/t/T motions
		if len(input) >= 2 && (input[0] == 'f' || input[0] == 'F' || input[0] == 't' || input[0] == 'T') {
			motionType := MotionFindChar
			inclusive := true
			direction := 1
			
			switch input[0] {
			case 'F':
				motionType = MotionFindCharBack
				direction = -1
			case 't':
				motionType = MotionTillChar
				inclusive = false
			case 'T':
				motionType = MotionTillCharBack
				inclusive = false
				direction = -1
			}
			
			return &Motion{
				Type:      motionType,
				Count:     count,
				Char:      rune(input[1]),
				Inclusive: inclusive,
				Direction: direction,
			}, input[2:]
		}
	}
	
	// Handle single character motions
	motion := p.parseMotion(string(input[0]))
	if motion != nil {
		motion.Count = count
		return motion, input[1:]
	}
	
	return nil, input
}

// ParseCommand parses a command string (for tests)
func (p *CommandParser) ParseCommand(input string) (*Command, error) {
	// Simple implementation for tests
	if len(input) == 0 {
		return nil, nil
	}
	
	// Extract count
	count := 1
	rest := input
	for len(rest) > 0 && rest[0] >= '0' && rest[0] <= '9' {
		if count == 1 && rest[0] != '0' {
			count = 0
		}
		if rest[0] != '0' || count > 0 {
			count = count*10 + int(rest[0]-'0')
		}
		rest = rest[1:]
	}
	if count == 0 {
		count = 1
	}
	
	// Check for register specification
	register := ""
	if len(rest) >= 2 && rest[0] == '"' {
		register = string(rest[1])
		rest = rest[2:]
	}
	
	// Parse operator
	if len(rest) > 0 {
		op := string(rest[0])
		switch op {
		case "d", "c", "y":
			// Check for doubled operator (dd, cc, yy)
			if len(rest) >= 2 && rest[1] == rest[0] {
				cmdType := CommandDelete
				if op == "c" {
					cmdType = CommandChange
				} else if op == "y" {
					cmdType = CommandYank
				}
				return &Command{
					Type:     cmdType,
					Count:    count,
					Register: register,
					Motion: &Motion{
						Type:      MotionLine,
						Count:     count,
						Inclusive: true,
					},
				}, nil
			}
			
			// Parse motion after operator
			motion, _ := p.ParseMotion(rest[1:], 1)
			if motion != nil {
				motion.Count = count
				// Special case for cw -> ce
				if op == "c" && motion.Type == MotionWord {
					motion.Type = MotionEndWord
					motion.Inclusive = true
				}
			}
			
			cmdType := CommandDelete
			if op == "c" {
				cmdType = CommandChange
			} else if op == "y" {
				cmdType = CommandYank
			}
			return &Command{
				Type:     cmdType,
				Count:    count,
				Register: register,
				Motion:   motion,
			}, nil
			
		case "D":
			return &Command{
				Type:     CommandDelete,
				Count:    count,
				Register: register,
				Motion: &Motion{
					Type:      MotionLineEnd,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			}, nil
			
		case "C":
			return &Command{
				Type:     CommandChange,
				Count:    count,
				Register: register,
				Motion: &Motion{
					Type:      MotionLineEnd,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			}, nil
			
		case "x", "s":
			cmdType := CommandDelete
			if op == "s" {
				cmdType = CommandSubstitute
			}
			return &Command{
				Type:     cmdType,
				Count:    count,
				Register: register,
				Motion: &Motion{
					Type:      MotionRight,
					Count:     count,
					Inclusive: false,
					Direction: 1,
				},
			}, nil
			
		case "p":
			return &Command{
				Type:     CommandPut,
				Count:    count,
				Register: register,
			}, nil
			
		case "P":
			return &Command{
				Type:     CommandPutBefore,
				Count:    count,
				Register: register,
			}, nil
			
		case "u":
			return &Command{
				Type:  CommandUndo,
				Count: count,
			}, nil
			
		case ".":
			return &Command{
				Type:  CommandRepeat,
				Count: count,
			}, nil
		}
		
		// Handle ctrl+r for redo
		if len(rest) == 1 && rest[0] == '\x12' {
			return &Command{
				Type:  CommandRedo,
				Count: count,
			}, nil
		}
	}
	
	// Check for motion-only command
	motion := p.parseMotion(input)
	if motion != nil {
		return &Command{
			Type:   CommandMotion,
			Count:  count,
			Motion: motion,
		}, nil
	}
	
	return nil, nil
}

// ShouldMarkText returns whether a command should mark text for repeat
func (p *CommandParser) ShouldMarkText(command string) bool {
	return command == "x" || command == "s"
}

// extractCount extracts count from input (for tests)
func (p *CommandParser) extractCount(input string) (int, string) {
	count := 1
	rest := input
	hasCount := false
	
	for len(rest) > 0 && rest[0] >= '0' && rest[0] <= '9' {
		if !hasCount && rest[0] == '0' {
			// Leading zero is not a count, it's the "0" motion
			break
		}
		if !hasCount {
			count = 0
			hasCount = true
		}
		count = count*10 + int(rest[0]-'0')
		rest = rest[1:]
	}
	
	if count == 0 {
		count = 1
	}
	
	return count, rest
}

// ParseKeys parses a key sequence and returns a command if complete
func (p *CommandParser) ParseKeys(mode VimMode, keys string, pendingOperator string, pendingCount string) (*VimCommand, bool) {
	// Handle search mode input
	if strings.HasPrefix(keys, "/") || strings.HasPrefix(keys, "?") {
		return p.parseSearchCommand(keys)
	}

	// In insert mode, most keys are just text
	if mode == ModeInsert {
		return p.parseInsertCommand(keys)
	}

	// Normal mode command parsing
	if mode == ModeNormal || mode == ModeVisual || mode == ModeVisualLine {
		return p.parseNormalCommand(keys, pendingOperator, pendingCount)
	}

	return nil, false
}

// parseNormalCommand parses commands in normal/visual mode
func (p *CommandParser) parseNormalCommand(key string, pendingOperator string, pendingCount string) (*VimCommand, bool) {
	// Extract count if present in the key
	countStr := pendingCount
	remainingKey := key

	// Check for numeric prefix in the current key
	if matched, _ := regexp.MatchString(`^\d+`, key); matched {
		re := regexp.MustCompile(`^(\d+)(.*)`)
		matches := re.FindStringSubmatch(key)
		if len(matches) > 2 {
			countStr += matches[1]
			remainingKey = matches[2]
		}
	}

	count := 1
	if countStr != "" {
		if parsed, err := strconv.Atoi(countStr); err == nil && parsed > 0 {
			count = parsed
		}
	}

	// Handle dot repeat
	if remainingKey == "." {
		return &VimCommand{
			Type:  CommandDotRepeat,
			Count: count,
		}, true
	}

	// Handle undo/redo
	if remainingKey == "u" {
		return &VimCommand{
			Type:  CommandUndo,
			Count: count,
		}, true
	}
	if remainingKey == "ctrl+r" {
		return &VimCommand{
			Type:  CommandRedo,
			Count: count,
		}, true
	}

	// Handle register specification
	if strings.HasPrefix(remainingKey, "\"") && len(remainingKey) > 1 {
		// register := string(remainingKey[1])
		// This is just setting the register, need to wait for the next command
		return nil, false
	}

	// Handle operators
	if pendingOperator == "" {
		if op := p.parseOperator(remainingKey); op != "" {
			// Special case: doubled operators work on whole line
			if remainingKey == op+op {
				return &VimCommand{
					Type:     CommandOperator,
					Count:    count,
					Operator: op,
					Motion: &Motion{
						Type:  MotionLine,
						Count: 1,
					},
				}, true
			}
			// Operator is pending, waiting for motion
			return nil, false
		}
	}

	// Handle motions
	if motion := p.parseMotion(remainingKey); motion != nil {
		motion.Count = count

		// If we have a pending operator, this completes the command
		if pendingOperator != "" {
			return &VimCommand{
				Type:     CommandOperator,
				Count:    count,
				Operator: pendingOperator,
				Motion:   motion,
			}, true
		}

		// Otherwise it's just a motion
		return &VimCommand{
			Type:   CommandMotion,
			Count:  1,
			Motion: motion,
		}, true
	}

	// Handle mode changes
	switch remainingKey {
	case "i":
		return &VimCommand{Type: CommandInsert, Text: "i"}, true
	case "a":
		return &VimCommand{Type: CommandInsert, Text: "a"}, true
	case "I":
		return &VimCommand{Type: CommandInsert, Text: "I"}, true
	case "A":
		return &VimCommand{Type: CommandInsert, Text: "A"}, true
	case "o":
		return &VimCommand{Type: CommandInsert, Text: "o"}, true
	case "O":
		return &VimCommand{Type: CommandInsert, Text: "O"}, true
	case "v":
		return &VimCommand{Type: CommandVisual}, true
	case "V":
		return &VimCommand{Type: CommandVisual, Text: "line"}, true
	}

	// Handle paste commands
	switch remainingKey {
	case "p":
		return &VimCommand{
			Type:  CommandPaste,
			Count: count,
			Text:  "after",
		}, true
	case "P":
		return &VimCommand{
			Type:  CommandPaste,
			Count: count,
			Text:  "before",
		}, true
	}

	// Handle single character operations
	switch remainingKey {
	case "x":
		// Delete character under cursor
		// For 'x', we want to delete from current position to current position + count
		// So we adjust the motion to be exclusive and the endpoint needs special handling
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1,
			Operator: "d",
			Motion: &Motion{
				Type:      MotionChar,
				Count:     count,
				Direction: 1,
			},
			Text: "x", // Mark this as 'x' command for special handling
		}, true
	case "X":
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1, // Command count is 1
			Operator: "d",
			Motion: &Motion{
				Type:      MotionChar,
				Count:     count, // Motion uses the actual count
				Direction: -1,
			},
		}, true
	case "r":
		// Replace mode needs another character
		return nil, false
	case "s":
		// Substitute character - delete char under cursor and enter insert mode
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1,
			Operator: "c",
			Motion: &Motion{
				Type:      MotionChar,
				Count:     count,
				Direction: 1,
			},
			Text: "s", // Mark this as 's' command for special handling
		}, true
	case "S":
		// Substitute line - delete line and enter insert mode
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1, // Command count is 1
			Operator: "c",
			Motion: &Motion{
				Type:  MotionLine,
				Count: count, // Motion uses the actual count
			},
		}, true
	case "D":
		// Delete to end of line
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1,
			Operator: "d",
			Motion: &Motion{
				Type: MotionLineEnd,
			},
		}, true
	}

	// Handle search initiation
	if remainingKey == "/" || remainingKey == "?" {
		// Search mode will be handled by search input
		return nil, false
	}

	// Handle search navigation
	if remainingKey == "n" {
		return &VimCommand{
			Type:  CommandSearch,
			Count: count,
			Text:  "next",
		}, true
	}
	if remainingKey == "N" {
		return &VimCommand{
			Type:  CommandSearch,
			Count: count,
			Text:  "prev",
		}, true
	}

	return nil, false
}

// parseOperator checks if the key is an operator
func (p *CommandParser) parseOperator(key string) string {
	switch key {
	case "d", "c", "y":
		return key
	}
	return ""
}

// parseMotion parses a motion command
func (p *CommandParser) parseMotion(key string) *Motion {
	switch key {
	case "h", "left":
		return &Motion{Type: MotionLeft, Direction: -1}
	case "l", "right":
		return &Motion{Type: MotionRight, Direction: 1}
	case "j", "down":
		return &Motion{Type: MotionDown, Direction: 1}
	case "k", "up":
		return &Motion{Type: MotionUp, Direction: -1}
	case "w":
		return &Motion{Type: MotionWord, Direction: 1}
	case "b":
		return &Motion{Type: MotionBackWord, Direction: -1}
	case "e":
		return &Motion{Type: MotionEndWord, Direction: 1}
	case "0", "home":
		return &Motion{Type: MotionLineStart, Direction: -1}
	case "^":
		return &Motion{Type: MotionLineStart, Direction: -1}
	case "$", "end":
		return &Motion{Type: MotionLineEnd, Direction: 1, Inclusive: true}
	case "gg":
		return &Motion{Type: MotionFileStart, Direction: -1}
	case "G":
		return &Motion{Type: MotionFileEnd, Direction: 1}
	}

	// Check for text objects (used with operators)
	if strings.HasPrefix(key, "i") || strings.HasPrefix(key, "a") {
		if len(key) >= 2 {
			// This is a text object, return a special motion
			// The actual text object parsing will be done when executing the operator
			return &Motion{
				Type:      MotionChar, // Placeholder
				Count:     0,          // Signal that this is a text object
				Direction: 0,
			}
		}
	}

	return nil
}

// parseInsertCommand parses commands in insert mode
func (p *CommandParser) parseInsertCommand(key string) (*VimCommand, bool) {
	switch key {
	case "esc", "ctrl+[":
		return &VimCommand{
			Type: CommandOther,
			Text: "escape",
		}, true
	case "ctrl+w":
		return &VimCommand{
			Type: CommandOther,
			Text: "delete-word",
		}, true
	case "ctrl+u":
		return &VimCommand{
			Type: CommandOther,
			Text: "delete-line",
		}, true
	}

	// Regular text insertion
	if len(key) > 0 {
		return &VimCommand{
			Type: CommandInsert,
			Text: key,
		}, true
	}

	return nil, false
}

// parseSearchCommand parses search commands
func (p *CommandParser) parseSearchCommand(input string) (*VimCommand, bool) {
	if len(input) < 1 {
		return nil, false
	}

	direction := input[0]
	pattern := input[1:]

	// Check if search is complete (would need to track Enter key separately)
	// For now, we'll assume search is triggered programmatically

	return &VimCommand{
		Type: CommandSearch,
		Text: string(direction) + pattern,
	}, false
}

// ParseTextObject parses a text object string (e.g., "iw", "a{")
func (p *CommandParser) ParseTextObject(obj string) string {
	validObjects := []string{
		"iw", "aw", // word
		"i\"", "a\"", // double quotes
		"i'", "a'", // single quotes
		"i(", "a(", "i)", "a)", // parentheses
		"i{", "a{", "i}", "a}", // braces
		"i[", "a[", "i]", "a]", // brackets
	}

	for _, valid := range validObjects {
		if obj == valid {
			return obj
		}
	}

	return ""
}
