package vim

import (
	"unicode"
)

// MotionType represents different types of motions
type MotionType int

const (
	MotionChar MotionType = iota
	MotionWord
	MotionWordEnd
	MotionLine
	MotionLineStart
	MotionLineEnd
	MotionDocumentStart
	MotionDocumentEnd
	MotionSearch
)

// Motion represents a movement command
type Motion struct {
	Type      MotionType
	Count     int
	Inclusive bool // For operator-pending mode
	Direction int  // -1 for backward, 1 for forward
}

// MotionEngine handles cursor movements and text object calculations
type MotionEngine struct{}

// NewMotionEngine creates a new motion engine
func NewMotionEngine() *MotionEngine {
	return &MotionEngine{}
}

// ExecuteMotion calculates the new cursor position after applying a motion
func (e *MotionEngine) ExecuteMotion(buffer [][]any, cursor Position, motion Motion) Position {
	newPos := cursor
	count := motion.Count

	// For line motions with count 0, we want to stay on the current line
	// (e.g., yy should operate on current line only)
	// For other motions, default to 1 if count is 0
	if count <= 0 && motion.Type != MotionLine {
		count = 1
	}

	switch motion.Type {
	case MotionChar:
		newPos = e.moveByChars(buffer, cursor, count*motion.Direction)
	case MotionWord:
		newPos = e.moveByWords(buffer, cursor, count, motion.Direction > 0)
	case MotionWordEnd:
		newPos = e.moveToWordEnd(buffer, cursor, count)
	case MotionLine:
		newPos = e.moveByLines(buffer, cursor, count*motion.Direction)
	case MotionLineStart:
		newPos = e.moveToLineStart(buffer, cursor)
	case MotionLineEnd:
		newPos = e.moveToLineEnd(buffer, cursor)
	case MotionDocumentStart:
		newPos = Position{Row: 0, Col: 0}
	case MotionDocumentEnd:
		lastRow := len(buffer) - 1
		if lastRow >= 0 {
			newPos = Position{Row: lastRow, Col: len(buffer[lastRow])}
		}
	}

	return e.clampPosition(buffer, newPos)
}

// moveByChars moves the cursor by a number of characters
func (e *MotionEngine) moveByChars(buffer [][]any, pos Position, count int) Position {
	if len(buffer) == 0 {
		return Position{0, 0}
	}

	row, col := pos.Row, pos.Col

	if count > 0 {
		// Moving forward
		for i := 0; i < count; i++ {
			if col < len(buffer[row])-1 {
				col++
			} else if row < len(buffer)-1 {
				row++
				col = 0
			}
		}
	} else {
		// Moving backward
		count = -count
		for i := 0; i < count; i++ {
			if col > 0 {
				col--
			} else if row > 0 {
				row--
				col = len(buffer[row]) - 1
				if col < 0 {
					col = 0
				}
			}
		}
	}

	return Position{Row: row, Col: col}
}

// moveByLines moves the cursor by a number of lines
func (e *MotionEngine) moveByLines(buffer [][]any, pos Position, count int) Position {
	row := pos.Row + count

	// Clamp to buffer bounds
	if row < 0 {
		row = 0
	} else if row >= len(buffer) {
		row = len(buffer) - 1
	}

	// Try to maintain column position
	col := pos.Col
	if row >= 0 && row < len(buffer) {
		if col > len(buffer[row]) {
			col = len(buffer[row])
		}
		// In normal mode, don't go past last character
		if col > 0 && col == len(buffer[row]) {
			col--
		}
	}

	return Position{Row: row, Col: col}
}

// moveToLineStart moves to the first non-whitespace character of the line
func (e *MotionEngine) moveToLineStart(buffer [][]any, pos Position) Position {
	if pos.Row >= len(buffer) {
		return pos
	}

	line := buffer[pos.Row]
	for i, item := range line {
		if r, ok := item.(rune); ok && !unicode.IsSpace(r) {
			return Position{Row: pos.Row, Col: i}
		}
	}

	// If all whitespace, go to column 0
	return Position{Row: pos.Row, Col: 0}
}

// moveToLineEnd moves to the end of the line
func (e *MotionEngine) moveToLineEnd(buffer [][]any, pos Position) Position {
	if pos.Row >= len(buffer) {
		return pos
	}

	col := len(buffer[pos.Row]) - 1
	if col < 0 {
		col = 0
	}

	return Position{Row: pos.Row, Col: col}
}

// moveByWords moves the cursor by a number of words
func (e *MotionEngine) moveByWords(buffer [][]any, pos Position, count int, forward bool) Position {
	if len(buffer) == 0 {
		return Position{0, 0}
	}

	row, col := pos.Row, pos.Col

	for i := 0; i < count; i++ {
		if forward {
			// Skip current word
			for row < len(buffer) && col < len(buffer[row]) && e.isWordChar(buffer[row][col]) {
				col++
				if col >= len(buffer[row]) {
					if row < len(buffer)-1 {
						row++
						col = 0
					} else {
						return Position{Row: row, Col: len(buffer[row]) - 1}
					}
				}
			}

			// Skip whitespace
			for row < len(buffer) && col < len(buffer[row]) && !e.isWordChar(buffer[row][col]) {
				col++
				if col >= len(buffer[row]) {
					if row < len(buffer)-1 {
						row++
						col = 0
					} else {
						return Position{Row: row, Col: len(buffer[row]) - 1}
					}
				}
			}
		} else {
			// Moving backward
			if col > 0 {
				col--
			} else if row > 0 {
				row--
				col = len(buffer[row]) - 1
			}

			// Skip whitespace
			for row >= 0 && col >= 0 && col < len(buffer[row]) && !e.isWordChar(buffer[row][col]) {
				if col > 0 {
					col--
				} else if row > 0 {
					row--
					col = len(buffer[row]) - 1
				} else {
					return Position{Row: 0, Col: 0}
				}
			}

			// Find start of word
			for row >= 0 && col > 0 && e.isWordChar(buffer[row][col-1]) {
				col--
			}
		}
	}

	return Position{Row: row, Col: col}
}

// moveToWordEnd moves to the end of the word
func (e *MotionEngine) moveToWordEnd(buffer [][]any, pos Position, count int) Position {
	if len(buffer) == 0 {
		return Position{0, 0}
	}

	row, col := pos.Row, pos.Col

	for i := 0; i < count; i++ {
		// Move at least one character forward
		if col < len(buffer[row])-1 {
			col++
		} else if row < len(buffer)-1 {
			row++
			col = 0
		}

		// Skip whitespace
		for row < len(buffer) && col < len(buffer[row]) && !e.isWordChar(buffer[row][col]) {
			col++
			if col >= len(buffer[row]) {
				if row < len(buffer)-1 {
					row++
					col = 0
				} else {
					return Position{Row: row, Col: len(buffer[row]) - 1}
				}
			}
		}

		// Move to end of word
		for row < len(buffer) && col < len(buffer[row])-1 && e.isWordChar(buffer[row][col+1]) {
			col++
		}
	}

	return Position{Row: row, Col: col}
}

// isWordChar determines if an item is a word character
func (e *MotionEngine) isWordChar(item any) bool {
	r, ok := item.(rune)
	if !ok {
		// Attachments are considered word boundaries
		return false
	}
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_'
}

// clampPosition ensures position is within buffer bounds
func (e *MotionEngine) clampPosition(buffer [][]any, pos Position) Position {
	if len(buffer) == 0 {
		return Position{0, 0}
	}

	// Clamp row
	if pos.Row < 0 {
		pos.Row = 0
	} else if pos.Row >= len(buffer) {
		pos.Row = len(buffer) - 1
	}

	// Clamp column
	if pos.Row >= 0 && pos.Row < len(buffer) {
		if pos.Col < 0 {
			pos.Col = 0
		} else if pos.Col > len(buffer[pos.Row]) {
			pos.Col = len(buffer[pos.Row])
			// In normal mode, don't go past last character
			if pos.Col > 0 {
				pos.Col--
			}
		}
	}

	return pos
}

// GetTextObject returns the range of a text object
func (e *MotionEngine) GetTextObject(buffer [][]any, cursor Position, object string) *TextRange {
	switch object {
	case "iw": // inner word
		return e.getInnerWord(buffer, cursor)
	case "aw": // around word
		return e.getAroundWord(buffer, cursor)
	case "i\"", "i'": // inner quotes
		quote := '"'
		if object == "i'" {
			quote = '\''
		}
		return e.getInnerQuotes(buffer, cursor, quote)
	case "a\"", "a'": // around quotes
		quote := '"'
		if object == "a'" {
			quote = '\''
		}
		return e.getAroundQuotes(buffer, cursor, quote)
	case "i(", "i)": // inner parentheses
		return e.getInnerPairs(buffer, cursor, '(', ')')
	case "a(", "a)": // around parentheses
		return e.getAroundPairs(buffer, cursor, '(', ')')
	case "i{", "i}": // inner braces
		return e.getInnerPairs(buffer, cursor, '{', '}')
	case "a{", "a}": // around braces
		return e.getAroundPairs(buffer, cursor, '{', '}')
	case "i[", "i]": // inner brackets
		return e.getInnerPairs(buffer, cursor, '[', ']')
	case "a[", "a]": // around brackets
		return e.getAroundPairs(buffer, cursor, '[', ']')
	}

	return nil
}

// getInnerWord returns the range of the inner word at cursor
func (e *MotionEngine) getInnerWord(buffer [][]any, cursor Position) *TextRange {
	if cursor.Row >= len(buffer) || len(buffer[cursor.Row]) == 0 {
		return nil
	}

	row := cursor.Row
	line := buffer[row]

	// If not on a word, return nil
	if cursor.Col >= len(line) || !e.isWordChar(line[cursor.Col]) {
		return nil
	}

	// Find word boundaries
	start := cursor.Col
	for start > 0 && e.isWordChar(line[start-1]) {
		start--
	}

	end := cursor.Col
	for end < len(line)-1 && e.isWordChar(line[end+1]) {
		end++
	}

	return &TextRange{
		Start: Position{Row: row, Col: start},
		End:   Position{Row: row, Col: end},
	}
}

// getAroundWord returns the range of the word including trailing whitespace
func (e *MotionEngine) getAroundWord(buffer [][]any, cursor Position) *TextRange {
	innerRange := e.getInnerWord(buffer, cursor)
	if innerRange == nil {
		return nil
	}

	row := cursor.Row
	line := buffer[row]
	end := innerRange.End.Col

	// Include trailing whitespace
	for end < len(line)-1 && e.isWhitespace(line[end+1]) {
		end++
	}

	return &TextRange{
		Start: innerRange.Start,
		End:   Position{Row: row, Col: end},
	}
}

// getInnerQuotes returns the range inside quotes
func (e *MotionEngine) getInnerQuotes(buffer [][]any, cursor Position, quote rune) *TextRange {
	if cursor.Row >= len(buffer) {
		return nil
	}

	row := cursor.Row
	line := buffer[row]
	col := cursor.Col

	// Find opening quote
	start := col
	foundStart := false
	for start >= 0 {
		if r, ok := line[start].(rune); ok && r == quote {
			foundStart = true
			start++
			break
		}
		start--
	}

	if !foundStart {
		return nil
	}

	// Find closing quote
	end := col
	if end < start {
		end = start
	}
	for end < len(line) {
		if r, ok := line[end].(rune); ok && r == quote {
			end--
			break
		}
		end++
	}

	if end >= len(line) {
		return nil
	}

	return &TextRange{
		Start: Position{Row: row, Col: start},
		End:   Position{Row: row, Col: end},
	}
}

// getAroundQuotes returns the range including quotes
func (e *MotionEngine) getAroundQuotes(buffer [][]any, cursor Position, quote rune) *TextRange {
	innerRange := e.getInnerQuotes(buffer, cursor, quote)
	if innerRange == nil {
		return nil
	}

	return &TextRange{
		Start: Position{Row: innerRange.Start.Row, Col: innerRange.Start.Col - 1},
		End:   Position{Row: innerRange.End.Row, Col: innerRange.End.Col + 1},
	}
}

// getInnerPairs returns the range inside paired delimiters
func (e *MotionEngine) getInnerPairs(buffer [][]any, cursor Position, open, close rune) *TextRange {
	// Simple implementation for single-line pairs
	// TODO: Implement multi-line support
	if cursor.Row >= len(buffer) {
		return nil
	}

	row := cursor.Row
	line := buffer[row]
	col := cursor.Col

	// Find opening delimiter
	start := col
	depth := 0
	for start >= 0 {
		if r, ok := line[start].(rune); ok {
			if r == close {
				depth++
			} else if r == open {
				if depth == 0 {
					start++
					break
				}
				depth--
			}
		}
		start--
	}

	if start < 0 {
		return nil
	}

	// Find closing delimiter
	end := col
	depth = 0
	for end < len(line) {
		if r, ok := line[end].(rune); ok {
			if r == open {
				depth++
			} else if r == close {
				if depth == 0 {
					end--
					break
				}
				depth--
			}
		}
		end++
	}

	if end >= len(line) {
		return nil
	}

	return &TextRange{
		Start: Position{Row: row, Col: start},
		End:   Position{Row: row, Col: end},
	}
}

// getAroundPairs returns the range including paired delimiters
func (e *MotionEngine) getAroundPairs(buffer [][]any, cursor Position, open, close rune) *TextRange {
	innerRange := e.getInnerPairs(buffer, cursor, open, close)
	if innerRange == nil {
		return nil
	}

	return &TextRange{
		Start: Position{Row: innerRange.Start.Row, Col: innerRange.Start.Col - 1},
		End:   Position{Row: innerRange.End.Row, Col: innerRange.End.Col + 1},
	}
}

// isWhitespace checks if an item is whitespace
func (e *MotionEngine) isWhitespace(item any) bool {
	r, ok := item.(rune)
	return ok && unicode.IsSpace(r)
}
