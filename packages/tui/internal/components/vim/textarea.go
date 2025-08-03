package vim

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/sst/opencode/internal/clipboard"
	"github.com/sst/opencode/internal/components/textarea"
)

// VimTextarea extends the textarea component with Vim functionality
type VimTextarea struct {
	*textarea.Model
	vimMode           *VimModeManager
	motionEngine      *MotionEngine
	parser            *CommandParser
	searchInput       string
	searchActive      bool
	pendingReplace    bool
	replaceChar       rune
	lastInsertStart   Position
	lastInsertCommand string // For dot repeat (i, a, o, etc.)
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// NewVimTextarea creates a new Vim-enabled textarea
func NewVimTextarea() *VimTextarea {
	ta := textarea.New()

	return &VimTextarea{
		Model:        &ta,
		vimMode:      NewVimModeManager(),
		motionEngine: NewMotionEngine(),
		parser:       NewCommandParser(),
	}
}

// Init implements tea.Model
func (v *VimTextarea) Init() tea.Cmd {
	return v.Model.Focus()
}

// Update handles messages and updates the component
func (v *VimTextarea) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	// Handle search input mode
	if v.searchActive {
		switch msg := msg.(type) {
		case tea.KeyPressMsg:
			switch msg.String() {
			case "esc", "ctrl+c":
				v.searchActive = false
				v.searchInput = ""
				return v, nil
			case "enter":
				v.searchActive = false
				if len(v.searchInput) > 1 {
					pattern := v.searchInput[1:]
					forward := v.searchInput[0] == '/'
					v.vimMode.SetSearchPattern(pattern, forward)
					// Execute search
					v.executeSearch(forward)
				}
				v.searchInput = ""
				return v, nil
			case "backspace":
				if len(v.searchInput) > 1 {
					v.searchInput = v.searchInput[:len(v.searchInput)-1]
				}
				return v, nil
			default:
				if msg.Text != "" {
					v.searchInput += msg.Text
				}
				return v, nil
			}
		}
		return v, nil
	}

	// Handle pending replace
	if v.pendingReplace {
		switch msg := msg.(type) {
		case tea.KeyPressMsg:
			if msg.Text != "" {
				v.replaceChar = []rune(msg.Text)[0]
				v.executeReplace()
				v.pendingReplace = false
			}
			return v, nil
		}
	}

	// If Vim mode is disabled, pass through to normal textarea
	if !v.vimMode.IsEnabled() {
		model, cmd := v.Model.Update(msg)
		v.Model = &model
		return v, cmd
	}

	// Handle Vim key events
	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		// No special early escape handling needed - handled in mode-specific handlers
		return v.handleVimKeys(msg)
	default:
		// Pass all other messages to the underlying textarea
		model, cmd := v.Model.Update(msg)
		v.Model = &model
		return v, cmd
	}
}

// handleVimKeys processes key events in Vim mode
func (v *VimTextarea) handleVimKeys(msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	keyStr := msg.String()
	mode := v.vimMode.CurrentMode()

	// Handle mode-specific keys
	switch mode {
	case ModeInsert:
		return v.handleInsertMode(keyStr, msg)
	case ModeNormal:
		return v.handleNormalMode(keyStr, msg)
	case ModeVisual, ModeVisualLine:
		return v.handleVisualMode(keyStr, msg)
	}

	return v, nil
}

// handleNormalMode processes keys in normal mode
func (v *VimTextarea) handleNormalMode(keyStr string, msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	// Handle search initiation
	if keyStr == "/" || keyStr == "?" {
		v.searchActive = true
		v.searchInput = keyStr
		return v, nil
	}

	// Handle replace mode
	if keyStr == "r" && !v.vimMode.IsOperatorPending() {
		v.pendingReplace = true
		return v, nil
	}

	// Check for count
	if len(keyStr) == 1 && keyStr[0] >= '0' && keyStr[0] <= '9' {
		// Don't accept 0 as first digit of count
		if !(v.vimMode.pendingCount == "" && keyStr == "0") {
			v.vimMode.AppendCount(keyStr)
			return v, nil
		}
	}

	// Check for doubled operators (dd, yy, cc)
	if v.vimMode.pendingOperator != "" && keyStr == v.vimMode.pendingOperator {
		// Get the count from pending count
		count := v.vimMode.GetCount()
		if count == 0 {
			count = 1
		}

		// Execute line operation
		// For doubled operators, we want to operate on N lines total
		// So motion count should be N-1 (to move down N-1 lines from current)
		motionCount := count - 1
		if motionCount < 0 {
			motionCount = 0
		}

		cmd := &VimCommand{
			Type:     CommandOperator,
			Count:    count,
			Operator: v.vimMode.pendingOperator,
			Motion: &Motion{
				Type:      MotionLine,
				Count:     motionCount,
				Direction: 1, // Always operate downward for line operations
			},
		}
		v.vimMode.ClearPendingOperator()
		v.vimMode.ClearCount()
		return v.executeCommand(cmd)
	}

	// Parse command
	cmd, complete := v.parser.ParseKeys(
		ModeNormal,
		keyStr,
		v.vimMode.pendingOperator,
		v.vimMode.pendingCount,
	)

	if !complete {
		// Check if this is an operator
		if op := v.parser.parseOperator(keyStr); op != "" {
			v.vimMode.SetPendingOperator(op)
		}
		return v, nil
	}

	// Execute the command
	return v.executeCommand(cmd)
}

// handleInsertMode processes keys in insert mode
func (v *VimTextarea) handleInsertMode(keyStr string, msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {

	// Check for escape - Bubble Tea v2 sends "esc"
	if keyStr == "esc" || keyStr == "ctrl+[" {
		v.vimMode.SetMode(ModeNormal)
		// Move cursor back one position (Vim behavior)
		if v.Model.CursorColumn() > 0 {
			v.CursorLeft()
		}
		// Record the insert for dot repeat
		v.recordInsertChange()
		return v, nil
	}

	// Pass through to textarea for text insertion
	model, cmd := v.Model.Update(msg)
	v.Model = &model
	return v, cmd
}

// handleVisualMode processes keys in visual mode
func (v *VimTextarea) handleVisualMode(keyStr string, msg tea.KeyPressMsg) (tea.Model, tea.Cmd) {
	// Check for escape
	if keyStr == "esc" || keyStr == "ctrl+[" {
		v.vimMode.SetMode(ModeNormal)
		return v, nil
	}

	// Visual mode operations
	switch keyStr {
	case "y": // Yank
		v.yankSelection()
		v.vimMode.SetMode(ModeNormal)
		return v, nil
	case "d", "x": // Delete
		v.deleteSelection()
		v.vimMode.SetMode(ModeNormal)
		return v, nil
	case "c": // Change
		v.deleteSelection()
		v.vimMode.SetMode(ModeInsert)
		v.lastInsertStart = v.getCursorPosition()
		return v, nil
	case "p": // Replace with paste
		v.replaceSelection()
		v.vimMode.SetMode(ModeNormal)
		return v, nil
	}

	// Handle motions to extend selection
	cmd, complete := v.parser.ParseKeys(
		v.vimMode.CurrentMode(),
		keyStr,
		"",
		v.vimMode.pendingCount,
	)

	if complete && cmd.Type == CommandMotion {
		v.extendVisualSelection(cmd.Motion)
	}

	v.vimMode.ClearCount()
	return v, nil
}

// executeCommand executes a parsed Vim command
func (v *VimTextarea) executeCommand(cmd *VimCommand) (tea.Model, tea.Cmd) {
	switch cmd.Type {
	case CommandMotion:
		v.executeMotion(cmd.Motion)

	case CommandOperator:
		v.executeOperator(cmd)

	case CommandInsert:
		v.enterInsertMode(cmd.Text)

	case CommandVisual:
		v.enterVisualMode(cmd.Text == "line")

	case CommandPaste:
		v.executePaste(cmd.Text == "after", cmd.Count)

	case CommandUndo:
		// Undo is not implemented in the base textarea
		// This would require maintaining an undo stack

	case CommandRedo:
		// Redo is not implemented in the base textarea
		// This would require maintaining a redo stack

	case CommandDotRepeat:
		v.executeDotRepeat(cmd.Count)

	case CommandSearch:
		if cmd.Text == "next" {
			v.searchNext(cmd.Count)
		} else if cmd.Text == "prev" {
			v.searchPrev(cmd.Count)
		}
	}

	// Clear pending states
	v.vimMode.ClearPendingOperator()
	v.vimMode.ClearCount()

	return v, nil
}

// executeMotion moves the cursor according to the motion
func (v *VimTextarea) executeMotion(motion *Motion) {
	// Convert string to buffer format for motion engine
	text := v.Value()
	lines := strings.Split(text, "\n")
	buffer := make([][]any, len(lines))
	for i, line := range lines {
		buffer[i] = make([]any, len(line))
		for j, r := range line {
			buffer[i][j] = r
		}
	}

	cursor := v.getCursorPosition()
	newPos := v.motionEngine.ExecuteMotion(buffer, cursor, *motion)
	v.setCursorPosition(newPos)
}

// executeOperator executes an operator with a motion
func (v *VimTextarea) executeOperator(cmd *VimCommand) {
	if cmd.Motion == nil {
		return
	}

	// Special handling for text objects
	// Note: Line operations can have Count == 0 (e.g., yy operates on current line only)
	// Text objects have Type == MotionChar and Direction == 0
	if cmd.Motion.Type == MotionChar && cmd.Motion.Direction == 0 && cmd.Motion.Count == 0 {
		// Text object motions are handled by the motion engine
		// They should have a count set by the parser
		return
	}

	cursor := v.getCursorPosition()

	// Calculate the range affected by the motion
	// Convert string to buffer format for motion engine
	text := v.Value()
	lines := strings.Split(text, "\n")
	textBuffer := make([][]any, len(lines))
	for i, line := range lines {
		textBuffer[i] = make([]any, len(line))
		for j, r := range line {
			textBuffer[i][j] = r
		}
	}
	endPos := v.motionEngine.ExecuteMotion(textBuffer, cursor, *cmd.Motion)

	// For delete/change operations with word motions, vim behavior is:
	// - 'dw' deletes from cursor to start of next word (including whitespace)
	// - 'de' deletes from cursor to end of current word (excluding whitespace)
	// The motion engine correctly positions us at the start of the nth word,
	// which is exactly where we want to delete up to for 'dw'.

	// Ensure start is before end
	startPos := cursor
	if endPos.Row < startPos.Row || (endPos.Row == startPos.Row && endPos.Col < startPos.Col) {
		startPos, endPos = endPos, startPos
	}

	// For line operations, extend the range to full lines
	if cmd.Motion.Type == MotionLine {
		// For line operations, the motion count indicates how many lines to operate on
		// The motion moved us down count-1 lines (since we start from current line)
		// So endPos is already at the last line we want to include

		// Special case: if startPos and endPos are on the same line (yy with no count),
		// we still want to operate on the whole line
		if startPos.Row == endPos.Row {
			// Ensure we're operating on at least the current line
			startPos.Col = 0
			lines := strings.Split(v.Value(), "\n")
			if startPos.Row < len(lines)-1 {
				// Not the last line, include up to the newline
				endPos = Position{Row: startPos.Row + 1, Col: 0}
			} else {
				// Last line, go to end
				endPos.Col = len(lines[startPos.Row])
			}
		} else {
			// Multi-line operation
			// Extend to beginning of start line
			startPos.Col = 0
			// Extend to end of end line (including newline if not last line)
			lines := strings.Split(v.Value(), "\n")
			if endPos.Row < len(lines)-1 {
				// Not the last line, include the newline
				endPos = Position{Row: endPos.Row + 1, Col: 0}
			} else {
				// Last line, go to end
				endPos.Col = len(lines[endPos.Row])
			}
		}
	}

	// Execute the operator
	switch cmd.Operator {
	case "d": // Delete
		text := v.extractText(startPos, endPos)
		linewise := cmd.Motion.Type == MotionLine
		v.vimMode.SetRegisterWithMetadata(cmd.Register, text, linewise)
		v.deleteRange(startPos, endPos)
		v.vimMode.SetLastChange(&Change{
			Type:     ChangeDelete,
			Text:     text,
			Position: startPos,
			Count:    cmd.Count,
			Motion:   cmd.Motion,
			Operator: "d",
		})

	case "c": // Change
		text := v.extractText(startPos, endPos)
		linewise := cmd.Motion.Type == MotionLine
		v.vimMode.SetRegisterWithMetadata(cmd.Register, text, linewise)
		v.deleteRange(startPos, endPos)
		v.vimMode.SetMode(ModeInsert)
		v.lastInsertStart = v.getCursorPosition()
		v.lastInsertCommand = "c" // Store for dot repeat

	case "y": // Yank
		text := v.extractText(startPos, endPos)
		linewise := cmd.Motion.Type == MotionLine
		v.vimMode.SetRegisterWithMetadata(cmd.Register, text, linewise)
		// Cursor returns to start of yanked text
		v.setCursorPosition(startPos)
	}
}

// enterInsertMode enters insert mode with the specified method
func (v *VimTextarea) enterInsertMode(method string) {
	v.vimMode.SetMode(ModeInsert)

	// Store the insert command for dot repeat
	v.lastInsertCommand = method

	switch method {
	case "a": // Append
		v.CursorRight()
	case "A": // Append at end of line
		v.CursorEnd()
	case "I": // Insert at beginning of line
		v.CursorStart()
	case "o": // Open line below
		v.CursorEnd()
		v.Newline()
	case "O": // Open line above
		v.CursorStart()
		v.InsertNewline()
		v.CursorUp()
	}

	v.lastInsertStart = v.getCursorPosition()
}

// enterVisualMode enters visual mode
func (v *VimTextarea) enterVisualMode(linewise bool) {
	if linewise {
		v.vimMode.SetMode(ModeVisualLine)
	} else {
		v.vimMode.SetMode(ModeVisual)
	}

	pos := v.getCursorPosition()
	v.vimMode.SetVisualStart(pos)
	v.vimMode.SetVisualEnd(pos)
}

// Helper methods

func (v *VimTextarea) getCursorPosition() Position {
	return Position{
		Row: v.Row(),
		Col: v.Column(),
	}
}

func (v *VimTextarea) setCursorPosition(pos Position) {
	// Ensure position is within bounds
	lines := strings.Split(v.Value(), "\n")
	if pos.Row >= len(lines) {
		pos.Row = len(lines) - 1
	}
	if pos.Row < 0 {
		pos.Row = 0
	}

	v.SetRow(pos.Row)
	v.SetCursorColumn(pos.Col)
}

func (v *VimTextarea) extractText(start, end Position) string {
	value := v.Value()
	lines := strings.Split(value, "\n")

	// Ensure positions are within bounds
	if start.Row >= len(lines) || end.Row >= len(lines) {
		return ""
	}

	if start.Row == end.Row {
		// Single line extraction
		line := lines[start.Row]
		startCol := min(start.Col, len(line))
		endCol := min(end.Col, len(line))
		if startCol <= endCol {
			// In visual mode, selection is inclusive of end position
			return line[startCol:min(endCol+1, len(line))]
		}
		return ""
	}

	// Multi-line extraction
	var result []string
	for row := start.Row; row <= end.Row && row < len(lines); row++ {
		line := lines[row]
		if row == start.Row {
			startCol := min(start.Col, len(line))
			result = append(result, line[startCol:])
		} else if row == end.Row {
			endCol := min(end.Col, len(line))
			// In visual mode, selection is inclusive of end position
			// Special case: if we're at column 0 of the last row, we've included up to the newline
			// of the previous row, so don't include any content from this row
			if endCol >= 0 {
				result = append(result, line[:min(endCol+1, len(line))])
			}
		} else {
			result = append(result, line)
		}
	}

	// Join the lines with newlines
	extracted := strings.Join(result, "\n")

	// Special case: if end position is at column 0 of a line that exists,
	// it means we want to include the newline after the previous line
	if end.Col == 0 && end.Row > start.Row && end.Row <= len(lines) {
		extracted += "\n"
	}

	return extracted
}

func (v *VimTextarea) deleteRange(start, end Position) {
	// Save current value
	originalValue := v.Value()
	lines := strings.Split(originalValue, "\n")

	if len(lines) == 0 || start.Row >= len(lines) || end.Row >= len(lines) {
		return
	}

	// Build the new text with the range deleted
	var newText string

	if start.Row == end.Row {
		// Single line deletion
		line := lines[start.Row]
		// In visual mode, deletion is inclusive of end position
		endColInclusive := min(end.Col+1, len(line))
		if start.Col < len(line) && end.Col < len(line) {
			newLine := line[:start.Col] + line[endColInclusive:]
			lines[start.Row] = newLine
			newText = strings.Join(lines, "\n")
		} else if start.Col < len(line) {
			// End is at or beyond line end, delete to end of line
			newLine := line[:start.Col]
			lines[start.Row] = newLine
			newText = strings.Join(lines, "\n")
		} else {
			return
		}
	} else {
		// Multi-line deletion
		var result []string

		// Add lines before the deletion
		for i := 0; i < start.Row; i++ {
			result = append(result, lines[i])
		}

		// Create merged line from start and end lines
		startLine := lines[start.Row]
		endLine := lines[end.Row]
		mergedLine := ""
		if start.Col < len(startLine) {
			mergedLine = startLine[:start.Col]
		}
		// In visual mode, deletion is inclusive of end position
		endColInclusive := min(end.Col+1, len(endLine))
		if endColInclusive < len(endLine) {
			mergedLine += endLine[endColInclusive:]
		}
		result = append(result, mergedLine)

		// Add lines after the deletion
		for i := end.Row + 1; i < len(lines); i++ {
			result = append(result, lines[i])
		}

		newText = strings.Join(result, "\n")
	}

	// Set the new value and restore cursor position
	v.SetValue(newText)
	v.setCursorPosition(start)
}

func (v *VimTextarea) executePaste(after bool, count int) {
	reg := v.vimMode.GetRegisterWithMetadata("")
	text := ""
	linewise := false

	if reg != nil {
		text = reg.Content
		linewise = reg.Linewise
	} else {
		// Try system clipboard
		if clipBytes := clipboard.Read(clipboard.FmtText); clipBytes != nil {
			text = string(clipBytes)
		}
	}

	if text == "" {
		return
	}

	for i := 0; i < count; i++ {
		if linewise {
			// Line-wise paste

			if after {
				// Move to end of current line
				v.CursorEnd()
				// Insert newline to create space for pasted content
				v.InsertNewline()
				// Insert the yanked line(s) - remove trailing newline if present
				// because we already added one
				textToInsert := text
				if strings.HasSuffix(textToInsert, "\n") {
					textToInsert = textToInsert[:len(textToInsert)-1]
				}
				v.InsertString(textToInsert)
			} else {
				// Move to start of current line
				v.CursorStart()
				// Insert the yanked line(s)
				v.InsertString(text)
				// The text should already have a newline from the yank operation
				// Move cursor to the beginning of the original line
				v.CursorStart()
			}
		} else {
			// Character-wise paste
			if after {
				v.CursorRight()
			}

			// Insert the text
			runes := []rune(text)
			v.InsertRunesFromUserInput(runes)

			if !after {
				v.CursorLeft()
			}
		}
	}
}

func (v *VimTextarea) executeReplace() {
	// Delete current character and insert replacement
	pos := v.getCursorPosition()
	v.CursorRight()
	endPos := v.getCursorPosition()

	if pos.Row != endPos.Row || pos.Col != endPos.Col {
		v.deleteRange(pos, endPos)
		v.InsertRunesFromUserInput([]rune{v.replaceChar})
		v.CursorLeft()
	}
}

func (v *VimTextarea) recordInsertChange() {
	// Record text inserted since entering insert mode
	endPos := v.getCursorPosition()
	text := v.extractText(v.lastInsertStart, endPos)

	v.vimMode.SetLastChange(&Change{
		Type:      ChangeInsert,
		Text:      text,
		Position:  v.lastInsertStart,
		Count:     1,
		InsertCmd: v.lastInsertCommand,
	})
}

func (v *VimTextarea) executeDotRepeat(count int) {
	change := v.vimMode.GetLastChange()
	if change == nil {
		return
	}

	// Use the original count if no new count specified
	if count == 0 {
		count = change.Count
	}

	for i := 0; i < count; i++ {
		switch change.Type {
		case ChangeInsert:
			// Handle different insert commands
			switch change.InsertCmd {
			case "a":
				v.CursorRight()
			case "A":
				v.CursorEnd()
			case "I":
				v.CursorStart()
			case "o":
				v.CursorEnd()
				v.Newline()
			case "O":
				v.CursorStart()
				v.InsertNewline()
				v.CursorUp()
			}
			// Insert the recorded text
			v.InsertRunesFromUserInput([]rune(change.Text))

		case ChangeDelete:
			// Repeat the delete operation with the stored motion
			if change.Motion != nil {
				cmd := &VimCommand{
					Type:     CommandOperator,
					Count:    1,
					Operator: "d",
					Motion:   change.Motion,
				}
				v.executeOperator(cmd)
			}

		case ChangeReplace:
			// For 'r' command, we need to store the replacement character
			// This would require enhancing the Change struct further
		}
	}
}

func (v *VimTextarea) executeSearch(forward bool) {
	pattern, _ := v.vimMode.GetSearchPattern()
	if pattern == "" {
		return
	}

	// Search functionality would require implementing
	// pattern matching across the buffer
}

func (v *VimTextarea) searchNext(count int) {
	pattern, forward := v.vimMode.GetSearchPattern()
	if pattern == "" {
		return
	}

	for i := 0; i < count; i++ {
		if forward {
			v.executeSearch(true)
		} else {
			v.executeSearch(false)
		}
	}
}

func (v *VimTextarea) searchPrev(count int) {
	pattern, forward := v.vimMode.GetSearchPattern()
	if pattern == "" {
		return
	}

	for i := 0; i < count; i++ {
		if forward {
			v.executeSearch(false)
		} else {
			v.executeSearch(true)
		}
	}
}

// Visual mode helpers

func (v *VimTextarea) extendVisualSelection(motion *Motion) {
	// Convert string to buffer format for motion engine
	text := v.Value()
	lines := strings.Split(text, "\n")
	buffer := make([][]any, len(lines))
	for i, line := range lines {
		buffer[i] = make([]any, len(line))
		for j, r := range line {
			buffer[i][j] = r
		}
	}

	cursor := v.getCursorPosition()
	newPos := v.motionEngine.ExecuteMotion(buffer, cursor, *motion)
	v.setCursorPosition(newPos)
	v.vimMode.SetVisualEnd(newPos)
}

func (v *VimTextarea) yankSelection() {
	range_ := v.vimMode.GetVisualRange()
	text := v.extractText(range_.Start, range_.End)
	linewise := v.vimMode.CurrentMode() == ModeVisualLine
	v.vimMode.SetRegisterWithMetadata("", text, linewise)

	// Also copy to system clipboard
	clipboard.Write(clipboard.FmtText, []byte(text))
}

func (v *VimTextarea) deleteSelection() {
	range_ := v.vimMode.GetVisualRange()
	text := v.extractText(range_.Start, range_.End)
	linewise := v.vimMode.CurrentMode() == ModeVisualLine
	v.vimMode.SetRegisterWithMetadata("", text, linewise)
	v.deleteRange(range_.Start, range_.End)
}

func (v *VimTextarea) replaceSelection() {
	v.deleteSelection()
	v.executePaste(false, 1)
}

// TextArea interface implementation

// View returns the view of the textarea
func (v *VimTextarea) View() string {
	// Always use custom rendering to properly handle visual mode
	return v.renderView()
}

// renderView renders the textarea, handling visual selection if active
func (v *VimTextarea) renderView() string {
	// If not in visual mode, return base view
	if v.vimMode.CurrentMode() != ModeVisual && v.vimMode.CurrentMode() != ModeVisualLine {
		return v.Model.View()
	}

	return v.renderWithVisualSelection()
}

// renderWithVisualSelection renders the textarea with visual selection highlighting
func (v *VimTextarea) renderWithVisualSelection() string {
	// Get the visual selection range
	selRange := v.vimMode.GetVisualRange()
	startPos, endPos := selRange.Start, selRange.End

	// For now, let's create a simple visual indicator by modifying the base view
	// Since ANSI codes aren't working well with lipgloss, we'll use a different approach
	baseView := v.Model.View()

	// Add a visual selection indicator to the status or as an overlay
	// For visual line mode, just return the base view for now
	if v.vimMode.CurrentMode() == ModeVisualLine {
		return baseView
	}

	// For character mode, we need a more sophisticated approach
	// Since lipgloss styles override ANSI codes, we'll add visual markers
	return v.addCharacterSelectionMarkers(baseView, startPos, endPos)
}

// addCharacterSelectionMarkers adds visual markers for character selection
func (v *VimTextarea) addCharacterSelectionMarkers(baseView string, startPos, endPos Position) string {
	// For now, just return the base view without any visual indicators
	// Proper character-by-character highlighting will be implemented later
	return baseView
}

// SetWidth sets the width of the textarea
func (v *VimTextarea) SetWidth(width int) {
	v.Model.SetWidth(width)
}

// SetHeight sets the height of the textarea
func (v *VimTextarea) SetHeight(height int) {
	v.Model.SetHeight(height)
}

// Length returns the length of the content
func (v *VimTextarea) Length() int {
	return v.Model.Length()
}

// LineCount returns the number of lines
func (v *VimTextarea) LineCount() int {
	return v.Model.LineCount()
}

// Focus sets focus on the textarea
func (v *VimTextarea) Focus() tea.Cmd {
	return v.Model.Focus()
}

// Blur removes focus from the textarea
func (v *VimTextarea) Blur() {
	v.Model.Blur()
}

// Focused returns whether the textarea is focused
func (v *VimTextarea) Focused() bool {
	return v.Model.Focused()
}

// InsertNewline inserts a newline
func (v *VimTextarea) InsertNewline() {
	v.Model.Newline()
}

// Reset resets the textarea
func (v *VimTextarea) Reset() {
	v.Model.Reset()
}

// GetAttachments returns the attachments
func (v *VimTextarea) GetAttachments() []*textarea.Attachment {
	return v.Model.GetAttachments()
}

// SetAttachment sets an attachment
func (v *VimTextarea) SetAttachment(attachment *textarea.Attachment) {
	v.Model.InsertAttachment(attachment)
}

// Paste handles paste operations
func (v *VimTextarea) Paste() tea.Cmd {
	// Model doesn't have Paste method
	return nil
}

// InsertString inserts a string at the current cursor position
func (v *VimTextarea) InsertString(s string) {
	v.Model.InsertString(s)
}

// ReplaceRange replaces text in the given range
func (v *VimTextarea) ReplaceRange(start, end int, replacement string) {
	v.Model.ReplaceRange(start, end, replacement)
}

// InsertAttachment inserts an attachment
func (v *VimTextarea) InsertAttachment(attachment *textarea.Attachment) {
	v.Model.InsertAttachment(attachment)
}

// Public methods specific to Vim

// EnableVimMode enables Vim mode
func (v *VimTextarea) EnableVimMode() {
	v.vimMode.Enable()
	// Keep focus so we can receive key events
	v.Model.Focus()
}

// DisableVimMode disables Vim mode
func (v *VimTextarea) DisableVimMode() {
	v.vimMode.Disable()
	v.Model.Focus() // Restore focus for regular editing
}

// IsVimEnabled returns whether Vim mode is enabled
func (v *VimTextarea) IsVimEnabled() bool {
	return v.vimMode.IsEnabled()
}

// GetVimStatusLine returns the Vim status line
func (v *VimTextarea) GetVimStatusLine() string {
	return v.vimMode.GetStatusLine()
}

// SetValue overrides the textarea SetValue to handle buffer format
func (v *VimTextarea) SetValue(s string) {
	v.Model.SetValue(s)
}

// Value returns the current text value as a string
func (v *VimTextarea) Value() string {
	return v.Model.Value()
}

// Additional helper methods for cursor movement
func (v *VimTextarea) CursorLeft() {
	col := v.Model.CursorColumn()
	if col > 0 {
		v.Model.SetCursorColumn(col - 1)
	}
}

func (v *VimTextarea) CursorRight() {
	col := v.Model.CursorColumn()
	lineLength := v.Model.CurrentRowLength()
	if col < lineLength {
		v.Model.SetCursorColumn(col + 1)
	}
}

func (v *VimTextarea) SetRow(row int) {
	// Move cursor to specified row by using up/down movements
	currentRow := v.Row()
	diff := row - currentRow

	if diff > 0 {
		for i := 0; i < diff; i++ {
			v.CursorDown()
		}
	} else if diff < 0 {
		for i := 0; i < -diff; i++ {
			v.CursorUp()
		}
	}
}

func (v *VimTextarea) CursorUp() {
	v.Model.CursorUp()
}

func (v *VimTextarea) CursorDown() {
	v.Model.CursorDown()
}

func (v *VimTextarea) CursorStart() {
	v.Model.CursorStart()
}

func (v *VimTextarea) CursorEnd() {
	v.Model.CursorEnd()
}

func (v *VimTextarea) Row() int {
	return v.Model.CursorRow()
}

func (v *VimTextarea) Column() int {
	return v.Model.CursorColumn()
}

func (v *VimTextarea) Newline() {
	v.InsertNewline()
}
