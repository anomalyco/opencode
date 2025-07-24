package diff

import (
	"bufio"
	"bytes"
	"fmt"
	"image/color"
	"io"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/alecthomas/chroma/v2"
	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/charmbracelet/x/ansi"
	"github.com/sergi/go-diff/diffmatchpatch"
	stylesi "github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
)

// -------------------------------------------------------------------------
// Core Types
// -------------------------------------------------------------------------

// LineType represents the kind of line in a diff.
type LineType int

const (
	LineContext LineType = iota // Line exists in both files
	LineAdded                   // Line added in the new file
	LineRemoved                 // Line removed from the old file
)

var (
	ansiRegex = regexp.MustCompile(`\x1b(?:[@-Z\\-_]|\[[0-9?]*(?:;[0-9?]*)*[@-~])`)
)

// Segment represents a portion of a line for intra-line highlighting
type Segment struct {
	Start int
	End   int
	Type  LineType
	Text  string
}

// DiffLine represents a single line in a diff
type DiffLine struct {
	OldLineNo int       // Line number in old file (0 for added lines)
	NewLineNo int       // Line number in new file (0 for removed lines)
	Kind      LineType  // Type of line (added, removed, context)
	Content   string    // Content of the line
	Segments  []Segment // Segments for intraline highlighting
}

// Hunk represents a section of changes in a diff
type Hunk struct {
	Header string
	Lines  []DiffLine
}

// DiffResult contains the parsed result of a diff
type DiffResult struct {
	OldFile string
	NewFile string
	Hunks   []Hunk
}

// linePair represents a pair of lines for side-by-side display
type linePair struct {
	left  *DiffLine
	right *DiffLine
}

// UnifiedConfig configures the rendering of unified diffs
type UnifiedConfig struct {
	Width int
}

// UnifiedOption modifies a UnifiedConfig
type UnifiedOption func(*UnifiedConfig)

// NewUnifiedConfig creates a UnifiedConfig with default values
func NewUnifiedConfig(opts ...UnifiedOption) UnifiedConfig {
	config := UnifiedConfig{
		Width: 80,
	}
	for _, opt := range opts {
		opt(&config)
	}
	return config
}

// NewSideBySideConfig creates a SideBySideConfig with default values
func NewSideBySideConfig(opts ...UnifiedOption) UnifiedConfig {
	config := UnifiedConfig{
		Width: 160,
	}
	for _, opt := range opts {
		opt(&config)
	}
	return config
}

// WithWidth sets the width for unified view
func WithWidth(width int) UnifiedOption {
	return func(u *UnifiedConfig) {
		if width > 0 {
			u.Width = width
		}
	}
}

// -------------------------------------------------------------------------
// Diff Parsing
// -------------------------------------------------------------------------

// ParseUnifiedDiff parses a unified diff format string into structured data
func ParseUnifiedDiff(diff string) (DiffResult, error) {
	var result DiffResult
	var currentHunk *Hunk
	result.Hunks = make([]Hunk, 0, 10) // Pre-allocate with a reasonable capacity

	scanner := bufio.NewScanner(strings.NewReader(diff))
	var oldLine, newLine int
	inFileHeader := true

	for scanner.Scan() {
		line := scanner.Text()

		if inFileHeader {
			if strings.HasPrefix(line, "--- a/") {
				result.OldFile = line[6:]
				continue
			}
			if strings.HasPrefix(line, "+++ b/") {
				result.NewFile = line[6:]
				inFileHeader = false
				continue
			}
		}

		if strings.HasPrefix(line, "@@") {
			if currentHunk != nil {
				result.Hunks = append(result.Hunks, *currentHunk)
			}
			currentHunk = &Hunk{
				Header: line,
				Lines:  make([]DiffLine, 0, 10), // Pre-allocate
			}

			// Manual parsing of hunk header is faster than regex
			parts := strings.Split(line, " ")
			if len(parts) > 2 {
				oldRange := strings.Split(parts[1][1:], ",")
				newRange := strings.Split(parts[2][1:], ",")
				oldLine, _ = strconv.Atoi(oldRange[0])
				newLine, _ = strconv.Atoi(newRange[0])
			}
			continue
		}

		if strings.HasPrefix(line, "\\ No newline at end of file") || currentHunk == nil {
			continue
		}

		var dl DiffLine
		dl.Content = line
		if len(line) > 0 {
			switch line[0] {
			case '+':
				dl.Kind = LineAdded
				dl.NewLineNo = newLine
				dl.Content = line[1:]
				newLine++
			case '-':
				dl.Kind = LineRemoved
				dl.OldLineNo = oldLine
				dl.Content = line[1:]
				oldLine++
			default: // context line
				dl.Kind = LineContext
				dl.OldLineNo = oldLine
				dl.NewLineNo = newLine
				oldLine++
				newLine++
			}
		} else { // empty context line
			dl.Kind = LineContext
			dl.OldLineNo = oldLine
			dl.NewLineNo = newLine
			oldLine++
			newLine++
		}
		currentHunk.Lines = append(currentHunk.Lines, dl)
	}

	if currentHunk != nil {
		result.Hunks = append(result.Hunks, *currentHunk)
	}

	return result, scanner.Err()
}

// HighlightIntralineChanges updates lines in a hunk to show character-level differences
func HighlightIntralineChanges(h *Hunk) {
	var updated []DiffLine
	dmp := diffmatchpatch.New()

	for i := 0; i < len(h.Lines); i++ {
		// Look for removed line followed by added line
		if i+1 < len(h.Lines) &&
			h.Lines[i].Kind == LineRemoved &&
			h.Lines[i+1].Kind == LineAdded {

			oldLine := h.Lines[i]
			newLine := h.Lines[i+1]

			// Find character-level differences
			patches := dmp.DiffMain(oldLine.Content, newLine.Content, false)
			patches = dmp.DiffCleanupSemantic(patches)
			patches = dmp.DiffCleanupMerge(patches)
			patches = dmp.DiffCleanupEfficiency(patches)

			segments := make([]Segment, 0)

			removeStart := 0
			addStart := 0
			for _, patch := range patches {
				switch patch.Type {
				case diffmatchpatch.DiffDelete:
					segments = append(segments, Segment{
						Start: removeStart,
						End:   removeStart + len(patch.Text),
						Type:  LineRemoved,
						Text:  patch.Text,
					})
					removeStart += len(patch.Text)
				case diffmatchpatch.DiffInsert:
					segments = append(segments, Segment{
						Start: addStart,
						End:   addStart + len(patch.Text),
						Type:  LineAdded,
						Text:  patch.Text,
					})
					addStart += len(patch.Text)
				default:
					// Context text, no highlighting needed
					removeStart += len(patch.Text)
					addStart += len(patch.Text)
				}
			}
			oldLine.Segments = segments
			newLine.Segments = segments

			updated = append(updated, oldLine, newLine)
			i++ // Skip the next line as we've already processed it
		} else {
			updated = append(updated, h.Lines[i])
		}
	}

	h.Lines = updated
}

// pairLines converts a flat list of diff lines to pairs for side-by-side display
func pairLines(lines []DiffLine) []linePair {
	var pairs []linePair
	i := 0

	for i < len(lines) {
		switch lines[i].Kind {
		case LineRemoved:
			// Check if the next line is an addition, if so pair them
			if i+1 < len(lines) && lines[i+1].Kind == LineAdded {
				pairs = append(pairs, linePair{left: &lines[i], right: &lines[i+1]})
				i += 2
			} else {
				pairs = append(pairs, linePair{left: &lines[i], right: nil})
				i++
			}
		case LineAdded:
			pairs = append(pairs, linePair{left: nil, right: &lines[i]})
			i++
		case LineContext:
			pairs = append(pairs, linePair{left: &lines[i], right: &lines[i]})
			i++
		}
	}

	return pairs
}

// -------------------------------------------------------------------------
// Syntax Highlighting
// -------------------------------------------------------------------------

// SyntaxHighlight applies syntax highlighting to text based on file extension
func SyntaxHighlight(w io.Writer, source, fileName, formatter string, bg color.Color) error {
	t := theme.CurrentTheme()

	// Determine the language lexer to use
	l := lexers.Match(fileName)
	if l == nil {
		l = lexers.Analyse(source)
	}
	if l == nil {
		l = lexers.Fallback
	}
	l = chroma.Coalesce(l)

	// Get the formatter
	f := formatters.Get(formatter)
	if f == nil {
		f = formatters.Fallback
	}

	// Dynamic theme based on current theme values
	syntaxThemeXml := fmt.Sprintf(`
	<style name="opencode-theme">
	<!-- Base colors -->
	<entry type="Background" style="bg:%s"/>
	<entry type="Text" style="%s"/>
	<entry type="Other" style="%s"/>
	<entry type="Error" style="%s"/>
	<!-- Keywords -->
	<entry type="Keyword" style="%s"/>
	<entry type="KeywordConstant" style="%s"/>
	<entry type="KeywordDeclaration" style="%s"/>
	<entry type="KeywordNamespace" style="%s"/>
	<entry type="KeywordPseudo" style="%s"/>
	<entry type="KeywordReserved" style="%s"/>
	<entry type="KeywordType" style="%s"/>
	<!-- Names -->
	<entry type="Name" style="%s"/>
	<entry type="NameAttribute" style="%s"/>
	<entry type="NameBuiltin" style="%s"/>
	<entry type="NameBuiltinPseudo" style="%s"/>
	<entry type="NameClass" style="%s"/>
	<entry type="NameConstant" style="%s"/>
	<entry type="NameDecorator" style="%s"/>
	<entry type="NameEntity" style="%s"/>
	<entry type="NameException" style="%s"/>
	<entry type="NameFunction" style="%s"/>
	<entry type="NameLabel" style="%s"/>
	<entry type="NameNamespace" style="%s"/>
	<entry type="NameOther" style="%s"/>
	<entry type="NameTag" style="%s"/>
	<entry type="NameVariable" style="%s"/>
	<entry type="NameVariableClass" style="%s"/>
	<entry type="NameVariableGlobal" style="%s"/>
	<entry type="NameVariableInstance" style="%s"/>
	<!-- Literals -->
	<entry type="Literal" style="%s"/>
	<entry type="LiteralDate" style="%s"/>
	<entry type="LiteralString" style="%s"/>
	<entry type="LiteralStringBacktick" style="%s"/>
	<entry type="LiteralStringChar" style="%s"/>
	<entry type="LiteralStringDoc" style="%s"/>
	<entry type="LiteralStringDouble" style="%s"/>
	<entry type="LiteralStringEscape" style="%s"/>
	<entry type="LiteralStringHeredoc" style="%s"/>
	<entry type="LiteralStringInterpol" style="%s"/>
	<entry type="LiteralStringOther" style="%s"/>
	<entry type="LiteralStringRegex" style="%s"/>
	<entry type="LiteralStringSingle" style="%s"/>
	<entry type="LiteralStringSymbol" style="%s"/>
	<!-- Numbers -->
	<entry type="LiteralNumber" style="%s"/>
	<entry type="LiteralNumberBin" style="%s"/>
	<entry type="LiteralNumberFloat" style="%s"/>
	<entry type="LiteralNumberHex" style="%s"/>
	<entry type="LiteralNumberInteger" style="%s"/>
	<entry type="LiteralNumberIntegerLong" style="%s"/>
	<entry type="LiteralNumberOct" style="%s"/>
	<!-- Operators -->
	<entry type="Operator" style="%s"/>
	<entry type="OperatorWord" style="%s"/>
	<entry type="Punctuation" style="%s"/>
	<!-- Comments -->
	<entry type="Comment" style="%s"/>
	<entry type="CommentHashbang" style="%s"/>
	<entry type="CommentMultiline" style="%s"/>
	<entry type="CommentSingle" style="%s"/>
	<entry type="CommentSpecial" style="%s"/>
	<entry type="CommentPreproc" style="%s"/>
	<!-- Generic styles -->
	<entry type="Generic" style="%s"/>
	<entry type="GenericDeleted" style="%s"/>
	<entry type="GenericEmph" style="italic %s"/>
	<entry type="GenericError" style="%s"/>
	<entry type="GenericHeading" style="bold %s"/>
	<entry type="GenericInserted" style="%s"/>
	<entry type="GenericOutput" style="%s"/>
	<entry type="GenericPrompt" style="%s"/>
	<entry type="GenericStrong" style="bold %s"/>
	<entry type="GenericSubheading" style="bold %s"/>
	<entry type="GenericTraceback" style="%s"/>
	<entry type="GenericUnderline" style="underline"/>
	<entry type="TextWhitespace" style="%s"/>
</style>
`,
		getChromaColor(t.BackgroundPanel()), // Background
		getChromaColor(t.Text()),            // Text
		getChromaColor(t.Text()),            // Other
		getChromaColor(t.Error()),           // Error

		getChromaColor(t.SyntaxKeyword()), // Keyword
		getChromaColor(t.SyntaxKeyword()), // KeywordConstant
		getChromaColor(t.SyntaxKeyword()), // KeywordDeclaration
		getChromaColor(t.SyntaxKeyword()), // KeywordNamespace
		getChromaColor(t.SyntaxKeyword()), // KeywordPseudo
		getChromaColor(t.SyntaxKeyword()), // KeywordReserved
		getChromaColor(t.SyntaxType()),    // KeywordType

		getChromaColor(t.Text()),           // Name
		getChromaColor(t.SyntaxVariable()), // NameAttribute
		getChromaColor(t.SyntaxType()),     // NameBuiltin
		getChromaColor(t.SyntaxVariable()), // NameBuiltinPseudo
		getChromaColor(t.SyntaxType()),     // NameClass
		getChromaColor(t.SyntaxVariable()), // NameConstant
		getChromaColor(t.SyntaxFunction()), // NameDecorator
		getChromaColor(t.SyntaxVariable()), // NameEntity
		getChromaColor(t.SyntaxType()),     // NameException
		getChromaColor(t.SyntaxFunction()), // NameFunction
		getChromaColor(t.Text()),           // NameLabel
		getChromaColor(t.SyntaxType()),     // NameNamespace
		getChromaColor(t.SyntaxVariable()), // NameOther
		getChromaColor(t.SyntaxKeyword()),  // NameTag
		getChromaColor(t.SyntaxVariable()), // NameVariable
		getChromaColor(t.SyntaxVariable()), // NameVariableClass
		getChromaColor(t.SyntaxVariable()), // NameVariableGlobal
		getChromaColor(t.SyntaxVariable()), // NameVariableInstance

		getChromaColor(t.SyntaxString()), // Literal
		getChromaColor(t.SyntaxString()), // LiteralDate
		getChromaColor(t.SyntaxString()), // LiteralString
		getChromaColor(t.SyntaxString()), // LiteralStringBacktick
		getChromaColor(t.SyntaxString()), // LiteralStringChar
		getChromaColor(t.SyntaxString()), // LiteralStringDoc
		getChromaColor(t.SyntaxString()), // LiteralStringDouble
		getChromaColor(t.SyntaxString()), // LiteralStringEscape
		getChromaColor(t.SyntaxString()), // LiteralStringHeredoc
		getChromaColor(t.SyntaxString()), // LiteralStringInterpol
		getChromaColor(t.SyntaxString()), // LiteralStringOther
		getChromaColor(t.SyntaxString()), // LiteralStringRegex
		getChromaColor(t.SyntaxString()), // LiteralStringSingle
		getChromaColor(t.SyntaxString()), // LiteralStringSymbol

		getChromaColor(t.SyntaxNumber()), // LiteralNumber
		getChromaColor(t.SyntaxNumber()), // LiteralNumberBin
		getChromaColor(t.SyntaxNumber()), // LiteralNumberFloat
		getChromaColor(t.SyntaxNumber()), // LiteralNumberHex
		getChromaColor(t.SyntaxNumber()), // LiteralNumberInteger
		getChromaColor(t.SyntaxNumber()), // LiteralNumberIntegerLong
		getChromaColor(t.SyntaxNumber()), // LiteralNumberOct

		getChromaColor(t.SyntaxOperator()),    // Operator
		getChromaColor(t.SyntaxKeyword()),     // OperatorWord
		getChromaColor(t.SyntaxPunctuation()), // Punctuation

		getChromaColor(t.SyntaxComment()), // Comment
		getChromaColor(t.SyntaxComment()), // CommentHashbang
		getChromaColor(t.SyntaxComment()), // CommentMultiline
		getChromaColor(t.SyntaxComment()), // CommentSingle
		getChromaColor(t.SyntaxComment()), // CommentSpecial
		getChromaColor(t.SyntaxKeyword()), // CommentPreproc

		getChromaColor(t.Text()),      // Generic
		getChromaColor(t.Error()),     // GenericDeleted
		getChromaColor(t.Text()),      // GenericEmph
		getChromaColor(t.Error()),     // GenericError
		getChromaColor(t.Text()),      // GenericHeading
		getChromaColor(t.Success()),   // GenericInserted
		getChromaColor(t.TextMuted()), // GenericOutput
		getChromaColor(t.Text()),      // GenericPrompt
		getChromaColor(t.Text()),      // GenericStrong
		getChromaColor(t.Text()),      // GenericSubheading
		getChromaColor(t.Error()),     // GenericTraceback
		getChromaColor(t.Text()),      // TextWhitespace
	)

	r := strings.NewReader(syntaxThemeXml)
	style := chroma.MustNewXMLStyle(r)

	// Modify the style to use the provided background
	s, err := style.Builder().Transform(
		func(t chroma.StyleEntry) chroma.StyleEntry {
			if _, ok := bg.(lipgloss.NoColor); ok {
				return t
			}
			r, g, b, _ := bg.RGBA()
			t.Background = chroma.NewColour(uint8(r>>8), uint8(g>>8), uint8(b>>8))
			return t
		},
	).Build()
	if err != nil {
		s = styles.Fallback
	}

	// Tokenize and format
	it, err := l.Tokenise(nil, source)
	if err != nil {
		return err
	}

	return f.Format(w, s, it)
}

// getColor returns the appropriate hex color string based on terminal background
func getColor(adaptiveColor compat.AdaptiveColor) *string {
	return stylesi.AdaptiveColorToString(adaptiveColor)
}

func getChromaColor(adaptiveColor compat.AdaptiveColor) string {
	color := stylesi.AdaptiveColorToString(adaptiveColor)
	if color == nil {
		return ""
	}
	return *color
}

// highlightLine applies syntax highlighting to a single line
func highlightLine(fileName string, line string, bg color.Color) string {
	var buf bytes.Buffer
	err := SyntaxHighlight(&buf, line, fileName, "terminal16m", bg)
	if err != nil {
		return line
	}
	return buf.String()
}

// createStyles generates the lipgloss styles needed for rendering diffs
func createStyles(t theme.Theme) (removedLineStyle, addedLineStyle, contextLineStyle, lineNumberStyle stylesi.Style) {
	removedLineStyle = stylesi.NewStyle().Background(t.DiffRemovedBg())
	addedLineStyle = stylesi.NewStyle().Background(t.DiffAddedBg())
	contextLineStyle = stylesi.NewStyle().Background(t.DiffContextBg())
	lineNumberStyle = stylesi.NewStyle().Foreground(t.TextMuted()).Background(t.DiffLineNumber())
	return
}

// -------------------------------------------------------------------------
// Rendering Functions
// -------------------------------------------------------------------------

// applyHighlighting applies intra-line highlighting to a piece of text
func applyHighlighting(content string, segments []Segment, segmentType LineType, highlightBg compat.AdaptiveColor) string {
	// Find all ANSI sequences in the content
	ansiMatches := ansiRegex.FindAllStringIndex(content, -1)

	// Build a mapping of visible character positions to their actual indices
	visibleIdx := 0
	ansiSequences := make(map[int]string)
	lastAnsiSeq := "\x1b[0m" // Default reset sequence

	for i := 0; i < len(content); {
		isAnsi := false
		for _, match := range ansiMatches {
			if match[0] == i {
				ansiSequences[visibleIdx] = content[match[0]:match[1]]
				lastAnsiSeq = content[match[0]:match[1]]
				i = match[1]
				isAnsi = true
				break
			}
		}
		if isAnsi {
			continue
		}

		// For non-ANSI positions, store the last ANSI sequence
		if _, exists := ansiSequences[visibleIdx]; !exists {
			ansiSequences[visibleIdx] = lastAnsiSeq
		}
		visibleIdx++

		// Properly advance by UTF-8 rune, not byte
		_, size := utf8.DecodeRuneInString(content[i:])
		i += size
	}

	// Apply highlighting
	var sb strings.Builder
	inSelection := false
	currentPos := 0

	// Get the appropriate color based on terminal background
	bg := getColor(highlightBg)
	fg := getColor(theme.CurrentTheme().BackgroundPanel())
	var bgColor color.Color
	var fgColor color.Color

	if bg != nil {
		bgColor = lipgloss.Color(*bg)
	}
	if fg != nil {
		fgColor = lipgloss.Color(*fg)
	}
	for i := 0; i < len(content); {
		// Check if we're at an ANSI sequence
		isAnsi := false
		for _, match := range ansiMatches {
			if match[0] == i {
				sb.WriteString(content[match[0]:match[1]]) // Preserve ANSI sequence
				i = match[1]
				isAnsi = true
				break
			}
		}
		if isAnsi {
			continue
		}

		// Check for segment boundaries
		for _, seg := range segments {
			if seg.Type == segmentType {
				if currentPos == seg.Start {
					inSelection = true
				}
				if currentPos == seg.End {
					inSelection = false
				}
			}
		}

		// Get current character (properly handle UTF-8)
		r, size := utf8.DecodeRuneInString(content[i:])
		char := string(r)

		if inSelection {
			// Get the current styling
			currentStyle := ansiSequences[currentPos]

			// Apply foreground and background highlight
			if fgColor != nil {
				sb.WriteString("\x1b[38;2;")
				r, g, b, _ := fgColor.RGBA()
				sb.WriteString(fmt.Sprintf("%d;%d;%dm", r>>8, g>>8, b>>8))
			} else {
				sb.WriteString("\x1b[49m")
			}
			if bgColor != nil {
				sb.WriteString("\x1b[48;2;")
				r, g, b, _ := bgColor.RGBA()
				sb.WriteString(fmt.Sprintf("%d;%d;%dm", r>>8, g>>8, b>>8))
			} else {
				sb.WriteString("\x1b[39m")
			}
			sb.WriteString(char)

			// Full reset of all attributes to ensure clean state
			sb.WriteString("\x1b[0m")

			// Reapply the original ANSI sequence
			sb.WriteString(currentStyle)
		} else {
			// Not in selection, just copy the character
			sb.WriteString(char)
		}

		currentPos++
		i += size
	}

	return sb.String()
}

// renderLinePrefix renders the line number and marker prefix for a diff line
func renderLinePrefix(dl DiffLine, lineNum string, marker string, lineNumberStyle stylesi.Style, t theme.Theme) string {
	// Style the marker based on line type
	var styledMarker string
	switch dl.Kind {
	case LineRemoved:
		styledMarker = stylesi.NewStyle().Foreground(t.DiffRemoved()).Background(t.DiffRemovedBg()).Render(marker)
	case LineAdded:
		styledMarker = stylesi.NewStyle().Foreground(t.DiffAdded()).Background(t.DiffAddedBg()).Render(marker)
	case LineContext:
		styledMarker = stylesi.NewStyle().Foreground(t.TextMuted()).Background(t.DiffContextBg()).Render(marker)
	default:
		styledMarker = marker
	}

	return lineNumberStyle.Render(lineNum + " " + styledMarker)
}

// renderLineContent renders the content of a diff line with syntax and intra-line highlighting
func renderLineContent(fileName string, dl DiffLine, bgStyle stylesi.Style, highlightColor compat.AdaptiveColor, width int) string {
	// Apply syntax highlighting
	content := highlightLine(fileName, dl.Content, bgStyle.GetBackground())

	// Apply intra-line highlighting if needed
	if len(dl.Segments) > 0 && (dl.Kind == LineRemoved || dl.Kind == LineAdded) {
		content = applyHighlighting(content, dl.Segments, dl.Kind, highlightColor)
	}

	// Add a padding space for added/removed lines
	if dl.Kind == LineRemoved || dl.Kind == LineAdded {
		content = bgStyle.Render(" ") + content
	}

	// Create the final line and truncate if needed
	return bgStyle.MaxHeight(1).Width(width).Render(
		ansi.Truncate(
			content,
			width,
			"...",
		),
	)
}

// renderUnifiedLine renders a single line in unified diff format
func renderUnifiedLine(fileName string, dl DiffLine, width int, t theme.Theme) string {
	removedLineStyle, addedLineStyle, contextLineStyle, lineNumberStyle := createStyles(t)

	// Determine line style and marker based on line type
	var marker string
	var bgStyle stylesi.Style
	var lineNum string
	var highlightColor compat.AdaptiveColor

	switch dl.Kind {
	case LineRemoved:
		marker = "-"
		bgStyle = removedLineStyle
		lineNumberStyle = lineNumberStyle.Background(t.DiffRemovedLineNumberBg()).Foreground(t.DiffRemoved())
		highlightColor = t.DiffHighlightRemoved() // TODO: handle "none"
		if dl.OldLineNo > 0 {
			lineNum = fmt.Sprintf("%6d       ", dl.OldLineNo)
		} else {
			lineNum = "            "
		}
	case LineAdded:
		marker = "+"
		bgStyle = addedLineStyle
		lineNumberStyle = lineNumberStyle.Background(t.DiffAddedLineNumberBg()).Foreground(t.DiffAdded())
		highlightColor = t.DiffHighlightAdded() // TODO: handle "none"
		if dl.NewLineNo > 0 {
			lineNum = fmt.Sprintf("      %7d", dl.NewLineNo)
		} else {
			lineNum = "            "
		}
	case LineContext:
		marker = " "
		bgStyle = contextLineStyle
		if dl.OldLineNo > 0 && dl.NewLineNo > 0 {
			lineNum = fmt.Sprintf("%6d %6d", dl.OldLineNo, dl.NewLineNo)
		} else {
			lineNum = "            "
		}
	}

	// Create the line prefix
	prefix := renderLinePrefix(dl, lineNum, marker, lineNumberStyle, t)

	// Render the content
	prefixWidth := ansi.StringWidth(prefix)
	contentWidth := width - prefixWidth
	content := renderLineContent(fileName, dl, bgStyle, highlightColor, contentWidth)

	return prefix + content
}

// renderDiffColumnLine is a helper function that handles the common logic for rendering diff columns
func renderDiffColumnLine(
	fileName string,
	dl *DiffLine,
	colWidth int,
	isLeftColumn bool,
	t theme.Theme,
) string {
	if dl == nil {
		contextLineStyle := stylesi.NewStyle().Background(t.DiffContextBg())
		return contextLineStyle.Width(colWidth).Render("")
	}

	removedLineStyle, addedLineStyle, contextLineStyle, lineNumberStyle := createStyles(t)

	// Determine line style based on line type and column
	var marker string
	var bgStyle stylesi.Style
	var lineNum string
	var highlightColor compat.AdaptiveColor

	if isLeftColumn {
		// Left column logic
		switch dl.Kind {
		case LineRemoved:
			marker = "-"
			bgStyle = removedLineStyle
			lineNumberStyle = lineNumberStyle.Background(t.DiffRemovedLineNumberBg()).Foreground(t.DiffRemoved())
			highlightColor = t.DiffHighlightRemoved() // TODO: handle "none"
		case LineAdded:
			marker = "?"
			bgStyle = contextLineStyle
		case LineContext:
			marker = " "
			bgStyle = contextLineStyle
		}

		// Format line number for left column
		if dl.OldLineNo > 0 {
			lineNum = fmt.Sprintf("%6d", dl.OldLineNo)
		}
	} else {
		// Right column logic
		switch dl.Kind {
		case LineAdded:
			marker = "+"
			bgStyle = addedLineStyle
			lineNumberStyle = lineNumberStyle.Background(t.DiffAddedLineNumberBg()).Foreground(t.DiffAdded())
			highlightColor = t.DiffHighlightAdded()
		case LineRemoved:
			marker = "?"
			bgStyle = contextLineStyle
		case LineContext:
			marker = " "
			bgStyle = contextLineStyle
		}

		// Format line number for right column
		if dl.NewLineNo > 0 {
			lineNum = fmt.Sprintf("%6d", dl.NewLineNo)
		}
	}

	// Create the line prefix
	prefix := renderLinePrefix(*dl, lineNum, marker, lineNumberStyle, t)

	// Determine if we should render content
	shouldRenderContent := (dl.Kind == LineRemoved && isLeftColumn) ||
		(dl.Kind == LineAdded && !isLeftColumn) ||
		dl.Kind == LineContext

	if !shouldRenderContent {
		return bgStyle.Width(colWidth).Render("")
	}

	// Render the content
	prefixWidth := ansi.StringWidth(prefix)
	contentWidth := colWidth - prefixWidth
	content := renderLineContent(fileName, *dl, bgStyle, highlightColor, contentWidth)

	return prefix + content
}

// renderLeftColumn formats the left side of a side-by-side diff
func renderLeftColumn(fileName string, dl *DiffLine, colWidth int) string {
	return renderDiffColumnLine(fileName, dl, colWidth, true, theme.CurrentTheme())
}

// renderRightColumn formats the right side of a side-by-side diff
func renderRightColumn(fileName string, dl *DiffLine, colWidth int) string {
	return renderDiffColumnLine(fileName, dl, colWidth, false, theme.CurrentTheme())
}

// -------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------

// RenderUnifiedHunk formats a hunk for unified display
func RenderUnifiedHunk(fileName string, h Hunk, opts ...UnifiedOption) string {
	// Apply options to create the configuration
	config := NewUnifiedConfig(opts...)

	// Make a copy of the hunk so we don't modify the original
	hunkCopy := Hunk{Lines: make([]DiffLine, len(h.Lines))}
	copy(hunkCopy.Lines, h.Lines)

	// Highlight changes within lines
	HighlightIntralineChanges(&hunkCopy)

	var sb strings.Builder
	sb.Grow(len(hunkCopy.Lines) * config.Width)

	util.WriteStringsPar(&sb, hunkCopy.Lines, func(line DiffLine) string {
		return renderUnifiedLine(fileName, line, config.Width, theme.CurrentTheme()) + "\n"
	})

	return sb.String()
}

// RenderSideBySideHunk formats a hunk for side-by-side display
func RenderSideBySideHunk(fileName string, h Hunk, opts ...UnifiedOption) string {
	// Apply options to create the configuration
	config := NewSideBySideConfig(opts...)

	// Make a copy of the hunk so we don't modify the original
	hunkCopy := Hunk{Lines: make([]DiffLine, len(h.Lines))}
	copy(hunkCopy.Lines, h.Lines)

	// Highlight changes within lines
	HighlightIntralineChanges(&hunkCopy)

	// Pair lines for side-by-side display
	pairs := pairLines(hunkCopy.Lines)

	// Calculate column width
	colWidth := config.Width / 2

	leftWidth := colWidth
	rightWidth := config.Width - colWidth
	var sb strings.Builder

	util.WriteStringsPar(&sb, pairs, func(p linePair) string {
		wg := &sync.WaitGroup{}
		var leftStr, rightStr string
		wg.Add(2)
		go func() {
			defer wg.Done()
			leftStr = renderLeftColumn(fileName, p.left, leftWidth)
		}()
		go func() {
			defer wg.Done()
			rightStr = renderRightColumn(fileName, p.right, rightWidth)
		}()
		wg.Wait()
		return leftStr + rightStr + "\n"
	})

	return sb.String()
}

// FormatUnifiedDiff creates a unified formatted view of a diff
func FormatUnifiedDiff(filename string, diffText string, opts ...UnifiedOption) (string, error) {
	diffResult, err := ParseUnifiedDiff(diffText)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	util.WriteStringsPar(&sb, diffResult.Hunks, func(h Hunk) string {
		return RenderUnifiedHunk(filename, h, opts...)
	})

	return sb.String(), nil
}

// FormatDiff creates a side-by-side formatted view of a diff
func FormatDiff(filename string, diffText string, opts ...UnifiedOption) (string, error) {
	diffResult, err := ParseUnifiedDiff(diffText)
	if err != nil {
		return "", err
	}

	var sb strings.Builder
	util.WriteStringsPar(&sb, diffResult.Hunks, func(h Hunk) string {
		return RenderSideBySideHunk(filename, h, opts...)
	})

	return sb.String(), nil
}
