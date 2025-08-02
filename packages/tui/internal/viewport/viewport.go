package viewport

import (
	"math"
	"strings"

	"github.com/charmbracelet/bubbles/v2/key"
	tea "github.com/charmbracelet/bubbletea/v2"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

const (
	defaultHorizontalStep = 6
)

// Option is a configuration option that works in conjunction with [New]. For
// example:
//
//	timer := New(WithWidth(10, WithHeight(5)))
type Option func(*Model)

// WithWidth is an initialization option that sets the width of the
// viewport. Pass as an argument to [New].
func WithWidth(w int) Option {
	return func(m *Model) {
		m.width = w
	}
}

// WithHeight is an initialization option that sets the height of the
// viewport. Pass as an argument to [New].
func WithHeight(h int) Option {
	return func(m *Model) {
		m.height = h
	}
}

// New returns a new model with the given width and height as well as default
// key mappings.
func New(opts ...Option) (m Model) {
	for _, opt := range opts {
		opt(&m)
	}
	m.setInitialValues()
	m.memo = &Memo{}
	return m
}

type Memo struct {
	dirty bool
	cache string
}

func (m *Memo) View(render func() string) string {
	if m.dirty {
		// slog.Debug("memo dirty")
		m.cache = render()
		m.dirty = false
		return m.cache
	}
	// slog.Debug("memo cache")
	return m.cache
}

func (m *Memo) Invalidate() {
	m.dirty = true
}

// Model is the Bubble Tea model for this viewport element.
type Model struct {
	memo   *Memo
	width  int
	height int
	KeyMap KeyMap

	// Whether or not to wrap text. If false, it'll allow horizontal scrolling
	// instead.
	SoftWrap bool

	// Whether or not to fill to the height of the viewport with empty lines.
	FillHeight bool

	// Whether or not to respond to the mouse. The mouse must be enabled in
	// Bubble Tea for this to work. For details, see the Bubble Tea docs.
	MouseWheelEnabled bool

	// The number of lines the mouse wheel will scroll. By default, this is 3.
	MouseWheelDelta int

	// YOffset is the vertical scroll position.
	YOffset int

	// xOffset is the horizontal scroll position.
	xOffset int

	// horizontalStep is the number of columns we move left or right during a
	// default horizontal scroll.
	horizontalStep int

	// YPosition is the position of the viewport in relation to the terminal
	// window. It's used in high performance rendering only.
	YPosition int

	// Style applies a lipgloss style to the viewport. Realistically, it's most
	// useful for setting borders, margins and padding.
	Style lipgloss.Style

	// LeftGutterFunc allows to define a [GutterFunc] that adds a column into
	// the left of the viewport, which is kept when horizontal scrolling.
	// This can be used for things like line numbers, selection indicators,
	// show statuses, etc.
	LeftGutterFunc GutterFunc

	initialized      bool
	lines            []string
	longestLineWidth int

	// HighlightStyle highlights the ranges set with [SetHighligths].
	HighlightStyle lipgloss.Style

	// SelectedHighlightStyle highlights the highlight range focused during
	// navigation.
	// Use [SetHighligths] to set the highlight ranges, and [HightlightNext]
	// and [HihglightPrevious] to navigate.
	SelectedHighlightStyle lipgloss.Style

	// StyleLineFunc allows to return a [lipgloss.Style] for each line.
	// The argument is the line index.
	StyleLineFunc func(int) lipgloss.Style

	highlights []highlightInfo
	hiIdx      int
}

// GutterFunc can be implemented and set into [Model.LeftGutterFunc].
//
// Example implementation showing line numbers:
//
//	func(info GutterContext) string {
//		if info.Soft {
//			return "     │ "
//		}
//		if info.Index >= info.TotalLines {
//			return "   ~ │ "
//		}
//		return fmt.Sprintf("%4d │ ", info.Index+1)
//	}
type GutterFunc func(GutterContext) string

// NoGutter is the default gutter used.
var NoGutter = func(GutterContext) string { return "" }

// GutterContext provides context to a [GutterFunc].
type GutterContext struct {
	Index      int
	TotalLines int
	Soft       bool
}

func (m *Model) setInitialValues() {
	m.KeyMap = DefaultKeyMap()
	m.MouseWheelEnabled = true
	m.MouseWheelDelta = 3
	m.initialized = true
	m.horizontalStep = defaultHorizontalStep
	m.LeftGutterFunc = NoGutter
}

// Init exists to satisfy the tea.Model interface for composability purposes.
func (m Model) Init() tea.Cmd {
	return nil
}

// Height returns the height of the viewport.
func (m Model) Height() int {
	return m.height
}

// SetHeight sets the height of the viewport.
func (m *Model) SetHeight(h int) {
	m.height = h
	m.memo.Invalidate()
}

// Width returns the width of the viewport.
func (m Model) Width() int {
	return m.width
}

// SetWidth sets the width of the viewport.
func (m *Model) SetWidth(w int) {
	m.width = w
	m.memo.Invalidate()
}

// AtTop returns whether or not the viewport is at the very top position.
func (m Model) AtTop() bool {
	return m.YOffset <= 0
}

// AtBottom returns whether or not the viewport is at or past the very bottom
// position.
func (m Model) AtBottom() bool {
	return m.YOffset >= m.maxYOffset()
}

// PastBottom returns whether or not the viewport is scrolled beyond the last
// line. This can happen when adjusting the viewport height.
func (m Model) PastBottom() bool {
	return m.YOffset > m.maxYOffset()
}

// ScrollPercent returns the amount scrolled as a float between 0 and 1.
func (m Model) ScrollPercent() float64 {
	count := m.lineCount()
	if m.Height() >= count {
		return 1.0
	}
	y := float64(m.YOffset)
	h := float64(m.Height())
	t := float64(count)
	v := y / (t - h)
	return math.Max(0.0, math.Min(1.0, v))
}

// HorizontalScrollPercent returns the amount horizontally scrolled as a float
// between 0 and 1.
func (m Model) HorizontalScrollPercent() float64 {
	if m.xOffset >= m.longestLineWidth-m.Width() {
		return 1.0
	}
	y := float64(m.xOffset)
	h := float64(m.Width())
	t := float64(m.longestLineWidth)
	v := y / (t - h)
	return math.Max(0.0, math.Min(1.0, v))
}

// SetContent set the pager's text content.
// Line endings will be normalized to '\n'.
func (m *Model) SetContent(s string) {
	s = strings.ReplaceAll(s, "\r\n", "\n") // normalize line endings
	m.SetContentLines(strings.Split(s, "\n"))
	m.memo.Invalidate()
}

// SetContentLines allows to set the lines to be shown instead of the content.
// If a given line has a \n in it, it'll be considered a [Model.SoftWrap].
// See also [Model.SetContent].
func (m *Model) SetContentLines(lines []string) {
	// if there's no content, set content to actual nil instead of one empty
	// line.
	m.lines = lines
	if len(m.lines) == 1 && ansi.StringWidth(m.lines[0]) == 0 {
		m.lines = nil
	}
	m.longestLineWidth = maxLineWidth(m.lines)
	m.ClearHighlights()

	if m.YOffset > m.maxYOffset() {
		m.GotoBottom()
	}
	m.memo.Invalidate()
}

// GetContent returns the entire content as a single string.
// Line endings are normalized to '\n'.
func (m Model) GetContent() string {
	return strings.Join(m.lines, "\n")
}

// calculateLine taking soft wrapping into account, returns the total viewable
// lines and the real-line index for the given yoffset.
func (m Model) calculateLine(yoffset int) (total, idx int) {
	if !m.SoftWrap {
		for i, line := range m.lines {
			adjust := max(1, lipgloss.Height(line))
			if yoffset >= total && yoffset < total+adjust {
				idx = i
			}
			total += adjust
		}
		if yoffset >= total {
			idx = len(m.lines)
		}
		return total, idx
	}

	maxWidth := m.maxWidth()
	var gutterSize int
	if m.LeftGutterFunc != nil {
		gutterSize = lipgloss.Width(m.LeftGutterFunc(GutterContext{}))
	}
	for i, line := range m.lines {
		adjust := max(1, lipgloss.Width(line)/(maxWidth-gutterSize))
		if yoffset >= total && yoffset < total+adjust {
			idx = i
		}
		total += adjust
	}
	if yoffset >= total {
		idx = len(m.lines)
	}
	return total, idx
}

// lineToIndex taking soft wrappign into account, return the real line index
// for the given line.
func (m Model) lineToIndex(y int) int {
	_, idx := m.calculateLine(y)
	return idx
}

// lineCount taking soft wrapping into account, return the total viewable line
// count (real lines + soft wrapped line).
func (m Model) lineCount() int {
	total, _ := m.calculateLine(0)
	return total
}

// maxYOffset returns the maximum possible value of the y-offset based on the
// viewport's content and set height.
func (m Model) maxYOffset() int {
	return max(0, m.lineCount()-m.Height()+m.Style.GetVerticalFrameSize())
}

// maxXOffset returns the maximum possible value of the x-offset based on the
// viewport's content and set width.
func (m Model) maxXOffset() int {
	return max(0, m.longestLineWidth-m.Width())
}

func (m Model) maxWidth() int {
	var gutterSize int
	if m.LeftGutterFunc != nil {
		gutterSize = lipgloss.Width(m.LeftGutterFunc(GutterContext{}))
	}
	return m.Width() -
		m.Style.GetHorizontalFrameSize() -
		gutterSize
}

func (m Model) maxHeight() int {
	return m.Height() - m.Style.GetVerticalFrameSize()
}

// visibleLines returns the lines that should currently be visible in the
// viewport.
func (m Model) visibleLines() (lines []string) {
	maxHeight := m.maxHeight()
	maxWidth := m.maxWidth()

	if m.lineCount() > 0 {
		pos := m.lineToIndex(m.YOffset)
		top := max(0, pos)
		bottom := clamp(pos+maxHeight, top, len(m.lines))
		lines = make([]string, bottom-top)
		copy(lines, m.lines[top:bottom])
		lines = m.styleLines(lines, top)
		lines = m.highlightLines(lines, top)
	}

	for m.FillHeight && len(lines) < maxHeight {
		lines = append(lines, "")
	}

	// if longest line fit within width, no need to do anything else.
	if (m.xOffset == 0 && m.longestLineWidth <= maxWidth) || maxWidth == 0 {
		return m.setupGutter(lines)
	}

	if m.SoftWrap {
		return m.softWrap(lines, maxWidth)
	}

	for i, line := range lines {
		sublines := strings.Split(line, "\n") // will only have more than 1 if caller used [Model.SetContentLines].
		for j := range sublines {
			sublines[j] = ansi.Cut(sublines[j], m.xOffset, m.xOffset+maxWidth)
		}
		lines[i] = strings.Join(sublines, "\n")
	}
	return m.setupGutter(lines)
}

// styleLines styles the lines using [Model.StyleLineFunc].
func (m Model) styleLines(lines []string, offset int) []string {
	if m.StyleLineFunc == nil {
		return lines
	}
	for i := range lines {
		lines[i] = m.StyleLineFunc(i + offset).Render(lines[i])
	}
	return lines
}

// highlightLines highlights the lines with [Model.HighlightStyle] and
// [Model.SelectedHighlightStyle].
func (m Model) highlightLines(lines []string, offset int) []string {
	if len(m.highlights) == 0 {
		return lines
	}
	for i := range lines {
		ranges := makeHighlightRanges(
			m.highlights,
			i+offset,
			m.HighlightStyle,
		)
		lines[i] = lipgloss.StyleRanges(lines[i], ranges...)
		if m.hiIdx < 0 {
			continue
		}
		sel := m.highlights[m.hiIdx]
		if hi, ok := sel.lines[i+offset]; ok {
			lines[i] = lipgloss.StyleRanges(lines[i], lipgloss.NewRange(
				hi[0],
				hi[1],
				m.SelectedHighlightStyle,
			))
		}
	}
	return lines
}

func (m Model) softWrap(lines []string, maxWidth int) []string {
	var wrappedLines []string
	total := m.TotalLineCount()
	for i, line := range lines {
		idx := 0
		for ansi.StringWidth(line) >= idx {
			truncatedLine := ansi.Cut(line, idx, maxWidth+idx)
			if m.LeftGutterFunc != nil {
				truncatedLine = m.LeftGutterFunc(GutterContext{
					Index:      i + m.YOffset,
					TotalLines: total,
					Soft:       idx > 0,
				}) + truncatedLine
			}
			wrappedLines = append(wrappedLines, truncatedLine)
			idx += maxWidth
		}
	}
	return wrappedLines
}

// setupGutter sets up the left gutter using [Moddel.LeftGutterFunc].
func (m Model) setupGutter(lines []string) []string {
	if m.LeftGutterFunc == nil {
		return lines
	}

	offset := max(0, m.lineToIndex(m.YOffset))
	total := m.TotalLineCount()
	result := make([]string, len(lines))
	for i := range lines {
		var line []string
		for j, realLine := range strings.Split(lines[i], "\n") {
			line = append(line, m.LeftGutterFunc(GutterContext{
				Index:      i + offset,
				TotalLines: total,
				Soft:       j > 0,
			})+realLine)
		}
		result[i] = strings.Join(line, "\n")
	}
	m.memo.Invalidate()
	return result
}

// SetYOffset sets the Y offset.
func (m *Model) SetYOffset(n int) {
	m.YOffset = clamp(n, 0, m.maxYOffset())
	m.memo.Invalidate()
}

// SetXOffset sets the X offset.
// No-op when soft wrap is enabled.
func (m *Model) SetXOffset(n int) {
	if m.SoftWrap {
		return
	}
	m.xOffset = clamp(n, 0, m.maxXOffset())
	m.memo.Invalidate()
}

// EnsureVisible ensures that the given line and column are in the viewport.
func (m *Model) EnsureVisible(line, colstart, colend int) {
	maxWidth := m.maxWidth()
	if colend <= maxWidth {
		m.SetXOffset(0)
	} else {
		m.SetXOffset(colstart - m.horizontalStep) // put one step to the left, feels more natural
	}

	if line < m.YOffset || line >= m.YOffset+m.maxHeight() {
		m.SetYOffset(line)
	}

	m.visibleLines()
}

// ViewDown moves the view down by the number of lines in the viewport.
// Basically, "page down".
func (m *Model) ViewDown() {
	if m.AtBottom() {
		return
	}

	m.LineDown(m.Height())
	m.memo.Invalidate()
}

// ViewUp moves the view up by one height of the viewport. Basically, "page up".
func (m *Model) ViewUp() {
	if m.AtTop() {
		return
	}

	m.LineUp(m.Height())
	m.memo.Invalidate()
}

// HalfViewDown moves the view down by half the height of the viewport.
func (m *Model) HalfViewDown() {
	if m.AtBottom() {
		return
	}

	m.LineDown(m.Height() / 2) //nolint:mnd
	m.memo.Invalidate()
}

// HalfViewUp moves the view up by half the height of the viewport.
func (m *Model) HalfViewUp() {
	if m.AtTop() {
		return
	}

	m.LineUp(m.Height() / 2) //nolint:mnd
	m.memo.Invalidate()
}

// LineDown moves the view down by the given number of lines.
func (m *Model) LineDown(n int) {
	if m.AtBottom() || n == 0 || len(m.lines) == 0 {
		return
	}

	// Make sure the number of lines by which we're going to scroll isn't
	// greater than the number of lines we actually have left before we reach
	// the bottom.
	m.SetYOffset(m.YOffset + n)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
}

// LineUp moves the view down by the given number of lines. Returns the new
// lines to show.
func (m *Model) LineUp(n int) {
	if m.AtTop() || n == 0 || len(m.lines) == 0 {
		return
	}

	// Make sure the number of lines by which we're going to scroll isn't
	// greater than the number of lines we are from the top.
	m.SetYOffset(m.YOffset - n)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
}

// TotalLineCount returns the total number of lines (both hidden and visible) within the viewport.
func (m Model) TotalLineCount() int {
	return m.lineCount()
}

// VisibleLineCount returns the number of the visible lines within the viewport.
func (m Model) VisibleLineCount() int {
	return len(m.visibleLines())
}

// GotoTop sets the viewport to the top position.
func (m *Model) GotoTop() (lines []string) {
	if m.AtTop() {
		return nil
	}

	m.SetYOffset(0)
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
	return m.visibleLines()
}

// GotoBottom sets the viewport to the bottom position.
func (m *Model) GotoBottom() (lines []string) {
	m.SetYOffset(m.maxYOffset())
	m.hiIdx = m.findNearedtMatch()
	m.memo.Invalidate()
	return m.visibleLines()
}

// SetHorizontalStep sets the amount of cells that the viewport moves in the
// default viewport keymapping. If set to 0 or less, horizontal scrolling is
// disabled.
func (m *Model) SetHorizontalStep(n int) {
	if n < 0 {
		n = 0
	}

	m.horizontalStep = n
	m.memo.Invalidate()
}

// MoveLeft moves the viewport to the left by the given number of columns.
func (m *Model) MoveLeft(cols int) {
	m.xOffset -= cols
	if m.xOffset < 0 {
		m.xOffset = 0
		m.memo.Invalidate()
	}
}

// MoveRight moves viewport to the right by the given number of columns.
func (m *Model) MoveRight(cols int) {
	// prevents over scrolling to the right
	w := m.maxWidth()
	if m.xOffset > m.longestLineWidth-w {
		return
	}
	m.xOffset += cols
}

// Resets lines indent to zero.
func (m *Model) ResetIndent() {
	m.xOffset = 0
	m.memo.Invalidate()
}

// SetHighlights sets ranges of characters to highlight.
// For instance, `[]int{[]int{2, 10}, []int{20, 30}}` will highlight characters
// 2 to 10 and 20 to 30.
// Note that highlights are not expected to transpose each other, and are also
// expected to be in order.
// Use [Model.SetHighlights] to set the highlight ranges, and
// [Model.HighlightNext] and [Model.HighlightPrevious] to navigate.
// Use [Model.ClearHighlights] to remove all highlights.
func (m *Model) SetHighlights(matches [][]int) {
	if len(matches) == 0 || len(m.lines) == 0 {
		return
	}
	m.highlights = parseMatches(m.GetContent(), matches)
	m.hiIdx = m.findNearedtMatch()
	m.showHighlight()
	m.memo.Invalidate()
}

// ClearHighlights clears previously set highlights.
func (m *Model) ClearHighlights() {
	m.highlights = nil
	m.hiIdx = -1
	m.memo.Invalidate()
}

func (m *Model) showHighlight() {
	if m.hiIdx == -1 {
		return
	}
	line, colstart, colend := m.highlights[m.hiIdx].coords()
	m.EnsureVisible(line, colstart, colend)
	m.memo.Invalidate()
}

// HighlightNext highlights the next match.
func (m *Model) HighlightNext() {
	if m.highlights == nil {
		return
	}

	m.hiIdx = (m.hiIdx + 1) % len(m.highlights)
	m.showHighlight()
	m.memo.Invalidate()
}

// HighlightPrevious highlights the previous match.
func (m *Model) HighlightPrevious() {
	if m.highlights == nil {
		return
	}

	m.hiIdx = (m.hiIdx - 1 + len(m.highlights)) % len(m.highlights)
	m.showHighlight()
	m.memo.Invalidate()
}

func (m Model) findNearedtMatch() int {
	for i, match := range m.highlights {
		if match.lineStart >= m.YOffset {
			return i
		}
	}
	return -1
}

// Update handles standard message-based viewport updates.
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
	m = m.updateAsModel(msg)
	return m, nil
}

// Author's note: this method has been broken out to make it easier to
// potentially transition Update to satisfy tea.Model.
func (m Model) updateAsModel(msg tea.Msg) Model {
	if !m.initialized {
		m.setInitialValues()
	}

	switch msg := msg.(type) {
	case tea.KeyPressMsg:
		switch {
		case key.Matches(msg, m.KeyMap.PageDown):
			m.ViewDown()

		case key.Matches(msg, m.KeyMap.PageUp):
			m.ViewUp()

		case key.Matches(msg, m.KeyMap.HalfPageDown):
			m.HalfViewDown()

		case key.Matches(msg, m.KeyMap.HalfPageUp):
			m.HalfViewUp()

		case key.Matches(msg, m.KeyMap.Down):
			m.LineDown(1)

		case key.Matches(msg, m.KeyMap.Up):
			m.LineUp(1)

		case key.Matches(msg, m.KeyMap.Left):
			m.MoveLeft(m.horizontalStep)

		case key.Matches(msg, m.KeyMap.Right):
			m.MoveRight(m.horizontalStep)
		}

	case tea.MouseWheelMsg:
		if !m.MouseWheelEnabled {
			break
		}

		switch msg.Button {
		case tea.MouseWheelDown:
			m.LineDown(m.MouseWheelDelta)

		case tea.MouseWheelUp:
			m.LineUp(m.MouseWheelDelta)
		}
	}

	return m
}

// View renders the viewport into a string.
func (m *Model) render() {
}

func (m Model) View() string {
	return m.memo.View(func() string {
		w, h := m.Width(), m.Height()
		if sw := m.Style.GetWidth(); sw != 0 {
			w = min(w, sw)
		}
		if sh := m.Style.GetHeight(); sh != 0 {
			h = min(h, sh)
		}
		contentWidth := w - m.Style.GetHorizontalFrameSize()
		contentHeight := h - m.Style.GetVerticalFrameSize()
		visible := m.visibleLines()
		contents := lipgloss.NewStyle().
			Width(contentWidth).      // pad to width.
			Height(contentHeight).    // pad to height.
			MaxHeight(contentHeight). // truncate height if taller.
			MaxWidth(contentWidth).   // truncate width if wider.
			Render(strings.Join(visible, "\n"))
		return m.Style.
			UnsetWidth().UnsetHeight(). // Style size already applied in contents.
			Render(contents)
	})
}

func clamp(v, low, high int) int {
	if high < low {
		low, high = high, low
	}
	return min(high, max(low, v))
}

func maxLineWidth(lines []string) int {
	result := 0
	for _, line := range lines {
		result = max(result, lipgloss.Width(line))
	}
	return result
}
