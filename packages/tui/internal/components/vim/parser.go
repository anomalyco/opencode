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
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1, // Command count is 1
			Operator: "d",
			Motion: &Motion{
				Type:      MotionChar,
				Count:     count, // Motion uses the actual count
				Direction: 1,
			},
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
		// Substitute character - delete char and enter insert mode
		return &VimCommand{
			Type:     CommandOperator,
			Count:    1, // Command count is 1
			Operator: "c",
			Motion: &Motion{
				Type:      MotionChar,
				Count:     count, // Motion uses the actual count
				Direction: 1,
			},
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
		return &Motion{Type: MotionChar, Direction: -1}
	case "l", "right":
		return &Motion{Type: MotionChar, Direction: 1}
	case "j", "down":
		return &Motion{Type: MotionLine, Direction: 1}
	case "k", "up":
		return &Motion{Type: MotionLine, Direction: -1}
	case "w":
		return &Motion{Type: MotionWord, Direction: 1}
	case "b":
		return &Motion{Type: MotionWord, Direction: -1}
	case "e":
		return &Motion{Type: MotionWordEnd, Direction: 1}
	case "0", "home":
		return &Motion{Type: MotionLineStart}
	case "^":
		return &Motion{Type: MotionLineStart}
	case "$", "end":
		return &Motion{Type: MotionLineEnd}
	case "gg":
		return &Motion{Type: MotionDocumentStart}
	case "G":
		return &Motion{Type: MotionDocumentEnd}
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
