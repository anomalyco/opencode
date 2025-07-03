package theme

import (
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// Theme defines the interface for all UI themes in the application.
// All colors must be defined as compat.AdaptiveColor to support
// both light and dark terminal backgrounds.
type Theme interface {
	Name() string

	// Background colors
	Background() compat.AdaptiveColor        // Radix 1
	BackgroundPanel() compat.AdaptiveColor   // Radix 2
	BackgroundElement() compat.AdaptiveColor // Radix 3

	// Border colors
	BorderSubtle() compat.AdaptiveColor // Radix 6
	Border() compat.AdaptiveColor       // Radix 7
	BorderActive() compat.AdaptiveColor // Radix 8

	// Brand colors
	Primary() compat.AdaptiveColor // Radix 9
	Secondary() compat.AdaptiveColor
	Accent() compat.AdaptiveColor

	// Text colors
	TextMuted() compat.AdaptiveColor // Radix 11
	Text() compat.AdaptiveColor      // Radix 12

	// Status colors
	Error() compat.AdaptiveColor
	Warning() compat.AdaptiveColor
	Success() compat.AdaptiveColor
	Info() compat.AdaptiveColor

	// Diff view colors
	DiffAdded() compat.AdaptiveColor
	DiffRemoved() compat.AdaptiveColor
	DiffContext() compat.AdaptiveColor
	DiffHunkHeader() compat.AdaptiveColor
	DiffHighlightAdded() compat.AdaptiveColor
	DiffHighlightRemoved() compat.AdaptiveColor
	DiffAddedBg() compat.AdaptiveColor
	DiffRemovedBg() compat.AdaptiveColor
	DiffContextBg() compat.AdaptiveColor
	DiffLineNumber() compat.AdaptiveColor
	DiffAddedLineNumberBg() compat.AdaptiveColor
	DiffRemovedLineNumberBg() compat.AdaptiveColor

	// Markdown colors
	MarkdownText() compat.AdaptiveColor
	MarkdownHeading() compat.AdaptiveColor
	MarkdownLink() compat.AdaptiveColor
	MarkdownLinkText() compat.AdaptiveColor
	MarkdownCode() compat.AdaptiveColor
	MarkdownBlockQuote() compat.AdaptiveColor
	MarkdownEmph() compat.AdaptiveColor
	MarkdownStrong() compat.AdaptiveColor
	MarkdownHorizontalRule() compat.AdaptiveColor
	MarkdownListItem() compat.AdaptiveColor
	MarkdownListEnumeration() compat.AdaptiveColor
	MarkdownImage() compat.AdaptiveColor
	MarkdownImageText() compat.AdaptiveColor
	MarkdownCodeBlock() compat.AdaptiveColor

	// Syntax highlighting colors
	SyntaxComment() compat.AdaptiveColor
	SyntaxKeyword() compat.AdaptiveColor
	SyntaxFunction() compat.AdaptiveColor
	SyntaxVariable() compat.AdaptiveColor
	SyntaxString() compat.AdaptiveColor
	SyntaxNumber() compat.AdaptiveColor
	SyntaxType() compat.AdaptiveColor
	SyntaxOperator() compat.AdaptiveColor
	SyntaxPunctuation() compat.AdaptiveColor
}

// BaseTheme provides a default implementation of the Theme interface
// that can be embedded in concrete theme implementations.
type BaseTheme struct {
	// Background colors
	BackgroundColor        compat.AdaptiveColor
	BackgroundPanelColor   compat.AdaptiveColor
	BackgroundElementColor compat.AdaptiveColor

	// Border colors
	BorderSubtleColor compat.AdaptiveColor
	BorderColor       compat.AdaptiveColor
	BorderActiveColor compat.AdaptiveColor

	// Brand colors
	PrimaryColor   compat.AdaptiveColor
	SecondaryColor compat.AdaptiveColor
	AccentColor    compat.AdaptiveColor

	// Text colors
	TextMutedColor compat.AdaptiveColor
	TextColor      compat.AdaptiveColor

	// Status colors
	ErrorColor   compat.AdaptiveColor
	WarningColor compat.AdaptiveColor
	SuccessColor compat.AdaptiveColor
	InfoColor    compat.AdaptiveColor

	// Diff view colors
	DiffAddedColor               compat.AdaptiveColor
	DiffRemovedColor             compat.AdaptiveColor
	DiffContextColor             compat.AdaptiveColor
	DiffHunkHeaderColor          compat.AdaptiveColor
	DiffHighlightAddedColor      compat.AdaptiveColor
	DiffHighlightRemovedColor    compat.AdaptiveColor
	DiffAddedBgColor             compat.AdaptiveColor
	DiffRemovedBgColor           compat.AdaptiveColor
	DiffContextBgColor           compat.AdaptiveColor
	DiffLineNumberColor          compat.AdaptiveColor
	DiffAddedLineNumberBgColor   compat.AdaptiveColor
	DiffRemovedLineNumberBgColor compat.AdaptiveColor

	// Markdown colors
	MarkdownTextColor            compat.AdaptiveColor
	MarkdownHeadingColor         compat.AdaptiveColor
	MarkdownLinkColor            compat.AdaptiveColor
	MarkdownLinkTextColor        compat.AdaptiveColor
	MarkdownCodeColor            compat.AdaptiveColor
	MarkdownBlockQuoteColor      compat.AdaptiveColor
	MarkdownEmphColor            compat.AdaptiveColor
	MarkdownStrongColor          compat.AdaptiveColor
	MarkdownHorizontalRuleColor  compat.AdaptiveColor
	MarkdownListItemColor        compat.AdaptiveColor
	MarkdownListEnumerationColor compat.AdaptiveColor
	MarkdownImageColor           compat.AdaptiveColor
	MarkdownImageTextColor       compat.AdaptiveColor
	MarkdownCodeBlockColor       compat.AdaptiveColor

	// Syntax highlighting colors
	SyntaxCommentColor     compat.AdaptiveColor
	SyntaxKeywordColor     compat.AdaptiveColor
	SyntaxFunctionColor    compat.AdaptiveColor
	SyntaxVariableColor    compat.AdaptiveColor
	SyntaxStringColor      compat.AdaptiveColor
	SyntaxNumberColor      compat.AdaptiveColor
	SyntaxTypeColor        compat.AdaptiveColor
	SyntaxOperatorColor    compat.AdaptiveColor
	SyntaxPunctuationColor compat.AdaptiveColor
}

// Implement the Theme interface for BaseTheme
func (t *BaseTheme) Primary() compat.AdaptiveColor   { return t.PrimaryColor }
func (t *BaseTheme) Secondary() compat.AdaptiveColor { return t.SecondaryColor }
func (t *BaseTheme) Accent() compat.AdaptiveColor    { return t.AccentColor }

func (t *BaseTheme) Error() compat.AdaptiveColor   { return t.ErrorColor }
func (t *BaseTheme) Warning() compat.AdaptiveColor { return t.WarningColor }
func (t *BaseTheme) Success() compat.AdaptiveColor { return t.SuccessColor }
func (t *BaseTheme) Info() compat.AdaptiveColor    { return t.InfoColor }

func (t *BaseTheme) Text() compat.AdaptiveColor      { return t.TextColor }
func (t *BaseTheme) TextMuted() compat.AdaptiveColor { return t.TextMutedColor }

func (t *BaseTheme) Background() compat.AdaptiveColor        { return t.BackgroundColor }
func (t *BaseTheme) BackgroundPanel() compat.AdaptiveColor   { return t.BackgroundPanelColor }
func (t *BaseTheme) BackgroundElement() compat.AdaptiveColor { return t.BackgroundElementColor }

func (t *BaseTheme) Border() compat.AdaptiveColor       { return t.BorderColor }
func (t *BaseTheme) BorderActive() compat.AdaptiveColor { return t.BorderActiveColor }
func (t *BaseTheme) BorderSubtle() compat.AdaptiveColor { return t.BorderSubtleColor }

func (t *BaseTheme) DiffAdded() compat.AdaptiveColor            { return t.DiffAddedColor }
func (t *BaseTheme) DiffRemoved() compat.AdaptiveColor          { return t.DiffRemovedColor }
func (t *BaseTheme) DiffContext() compat.AdaptiveColor          { return t.DiffContextColor }
func (t *BaseTheme) DiffHunkHeader() compat.AdaptiveColor       { return t.DiffHunkHeaderColor }
func (t *BaseTheme) DiffHighlightAdded() compat.AdaptiveColor   { return t.DiffHighlightAddedColor }
func (t *BaseTheme) DiffHighlightRemoved() compat.AdaptiveColor { return t.DiffHighlightRemovedColor }
func (t *BaseTheme) DiffAddedBg() compat.AdaptiveColor          { return t.DiffAddedBgColor }
func (t *BaseTheme) DiffRemovedBg() compat.AdaptiveColor        { return t.DiffRemovedBgColor }
func (t *BaseTheme) DiffContextBg() compat.AdaptiveColor        { return t.DiffContextBgColor }
func (t *BaseTheme) DiffLineNumber() compat.AdaptiveColor       { return t.DiffLineNumberColor }
func (t *BaseTheme) DiffAddedLineNumberBg() compat.AdaptiveColor {
	return t.DiffAddedLineNumberBgColor
}
func (t *BaseTheme) DiffRemovedLineNumberBg() compat.AdaptiveColor {
	return t.DiffRemovedLineNumberBgColor
}

func (t *BaseTheme) MarkdownText() compat.AdaptiveColor       { return t.MarkdownTextColor }
func (t *BaseTheme) MarkdownHeading() compat.AdaptiveColor    { return t.MarkdownHeadingColor }
func (t *BaseTheme) MarkdownLink() compat.AdaptiveColor       { return t.MarkdownLinkColor }
func (t *BaseTheme) MarkdownLinkText() compat.AdaptiveColor   { return t.MarkdownLinkTextColor }
func (t *BaseTheme) MarkdownCode() compat.AdaptiveColor       { return t.MarkdownCodeColor }
func (t *BaseTheme) MarkdownBlockQuote() compat.AdaptiveColor { return t.MarkdownBlockQuoteColor }
func (t *BaseTheme) MarkdownEmph() compat.AdaptiveColor       { return t.MarkdownEmphColor }
func (t *BaseTheme) MarkdownStrong() compat.AdaptiveColor     { return t.MarkdownStrongColor }
func (t *BaseTheme) MarkdownHorizontalRule() compat.AdaptiveColor {
	return t.MarkdownHorizontalRuleColor
}
func (t *BaseTheme) MarkdownListItem() compat.AdaptiveColor { return t.MarkdownListItemColor }
func (t *BaseTheme) MarkdownListEnumeration() compat.AdaptiveColor {
	return t.MarkdownListEnumerationColor
}
func (t *BaseTheme) MarkdownImage() compat.AdaptiveColor     { return t.MarkdownImageColor }
func (t *BaseTheme) MarkdownImageText() compat.AdaptiveColor { return t.MarkdownImageTextColor }
func (t *BaseTheme) MarkdownCodeBlock() compat.AdaptiveColor { return t.MarkdownCodeBlockColor }

func (t *BaseTheme) SyntaxComment() compat.AdaptiveColor     { return t.SyntaxCommentColor }
func (t *BaseTheme) SyntaxKeyword() compat.AdaptiveColor     { return t.SyntaxKeywordColor }
func (t *BaseTheme) SyntaxFunction() compat.AdaptiveColor    { return t.SyntaxFunctionColor }
func (t *BaseTheme) SyntaxVariable() compat.AdaptiveColor    { return t.SyntaxVariableColor }
func (t *BaseTheme) SyntaxString() compat.AdaptiveColor      { return t.SyntaxStringColor }
func (t *BaseTheme) SyntaxNumber() compat.AdaptiveColor      { return t.SyntaxNumberColor }
func (t *BaseTheme) SyntaxType() compat.AdaptiveColor        { return t.SyntaxTypeColor }
func (t *BaseTheme) SyntaxOperator() compat.AdaptiveColor    { return t.SyntaxOperatorColor }
func (t *BaseTheme) SyntaxPunctuation() compat.AdaptiveColor { return t.SyntaxPunctuationColor }
