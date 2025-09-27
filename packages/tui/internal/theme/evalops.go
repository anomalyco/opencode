package theme

import (
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
)

// EvalOpsTheme is the official theme for EvalOps™
// "Trust, but Verify"
type EvalOpsTheme struct {
	BaseTheme
	name string
}

// NewEvalOpsTheme creates the EvalOps branded theme
func NewEvalOpsTheme() *EvalOpsTheme {
	// EvalOps brand colors
	// Primary: Indigo (#6366F1)
	// Secondary: Purple (#8B5CF6)
	// Accent: Cyan (#06B6D4)
	// Success: Emerald (#10B981)
	// Warning: Amber (#F59E0B)
	// Error: Red (#EF4444)

	theme := &EvalOpsTheme{
		name: "evalops",
		BaseTheme: BaseTheme{
			// Background colors - dark theme with subtle purple tint
			BackgroundColor:        compat.AdaptiveColor{Light: lipgloss.Color("#FAFAFA"), Dark: lipgloss.Color("#0A0A0F")}, // Near black with purple tint
			BackgroundPanelColor:   compat.AdaptiveColor{Light: lipgloss.Color("#F5F5FF"), Dark: lipgloss.Color("#13131A")}, // Slightly lighter
			BackgroundElementColor: compat.AdaptiveColor{Light: lipgloss.Color("#E8E8FF"), Dark: lipgloss.Color("#1A1A25")}, // Panel background

			// Border colors with indigo tint
			BorderSubtleColor: compat.AdaptiveColor{Light: lipgloss.Color("#D1D1E8"), Dark: lipgloss.Color("#2D2D3A")},
			BorderColor:       compat.AdaptiveColor{Light: lipgloss.Color("#A5A5CF"), Dark: lipgloss.Color("#404050")},
			BorderActiveColor: compat.AdaptiveColor{Light: lipgloss.Color("#6366F1"), Dark: lipgloss.Color("#6366F1")}, // Brand indigo

			// Brand colors - EvalOps signature palette
			PrimaryColor:   compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")}, // Indigo
			SecondaryColor: compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#8B5CF6")}, // Purple
			AccentColor:    compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")}, // Cyan

			// Text colors
			TextMutedColor: compat.AdaptiveColor{Light: lipgloss.Color("#6B7280"), Dark: lipgloss.Color("#9CA3AF")},
			TextColor:      compat.AdaptiveColor{Light: lipgloss.Color("#111827"), Dark: lipgloss.Color("#F9FAFB")},

			// Status colors - EvalOps evaluation states
			ErrorColor:   compat.AdaptiveColor{Light: lipgloss.Color("#DC2626"), Dark: lipgloss.Color("#EF4444")}, // Red
			WarningColor: compat.AdaptiveColor{Light: lipgloss.Color("#D97706"), Dark: lipgloss.Color("#F59E0B")}, // Amber
			SuccessColor: compat.AdaptiveColor{Light: lipgloss.Color("#059669"), Dark: lipgloss.Color("#10B981")}, // Emerald
			InfoColor:    compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")}, // Cyan

			// Diff view colors with EvalOps tint
			DiffAddedColor:               compat.AdaptiveColor{Light: lipgloss.Color("#059669"), Dark: lipgloss.Color("#10B981")},
			DiffRemovedColor:             compat.AdaptiveColor{Light: lipgloss.Color("#DC2626"), Dark: lipgloss.Color("#EF4444")},
			DiffContextColor:             compat.AdaptiveColor{Light: lipgloss.Color("#6B7280"), Dark: lipgloss.Color("#9CA3AF")},
			DiffHunkHeaderColor:          compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")},
			DiffHighlightAddedColor:      compat.AdaptiveColor{Light: lipgloss.Color("#34D399"), Dark: lipgloss.Color("#34D399")},
			DiffHighlightRemovedColor:    compat.AdaptiveColor{Light: lipgloss.Color("#F87171"), Dark: lipgloss.Color("#F87171")},
			DiffAddedBgColor:             compat.AdaptiveColor{Light: lipgloss.Color("#D1FAE5"), Dark: lipgloss.Color("#064E3B")},
			DiffRemovedBgColor:           compat.AdaptiveColor{Light: lipgloss.Color("#FEE2E2"), Dark: lipgloss.Color("#7F1D1D")},
			DiffContextBgColor:           compat.AdaptiveColor{Light: lipgloss.Color("#F9FAFB"), Dark: lipgloss.Color("#111827")},
			DiffLineNumberColor:          compat.AdaptiveColor{Light: lipgloss.Color("#9CA3AF"), Dark: lipgloss.Color("#6B7280")},
			DiffAddedLineNumberBgColor:   compat.AdaptiveColor{Light: lipgloss.Color("#A7F3D0"), Dark: lipgloss.Color("#047857")},
			DiffRemovedLineNumberBgColor: compat.AdaptiveColor{Light: lipgloss.Color("#FECACA"), Dark: lipgloss.Color("#991B1B")},

			// Markdown colors with EvalOps branding
			MarkdownTextColor:            compat.AdaptiveColor{Light: lipgloss.Color("#374151"), Dark: lipgloss.Color("#E5E7EB")},
			MarkdownHeadingColor:         compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")}, // Brand indigo
			MarkdownLinkColor:            compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#8B5CF6")}, // Brand purple
			MarkdownLinkTextColor:        compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#A78BFA")},
			MarkdownCodeColor:            compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")}, // Brand cyan
			MarkdownBlockQuoteColor:      compat.AdaptiveColor{Light: lipgloss.Color("#6B7280"), Dark: lipgloss.Color("#9CA3AF")},
			MarkdownEmphColor:            compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#8B5CF6")},
			MarkdownStrongColor:          compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")},
			MarkdownHorizontalRuleColor:  compat.AdaptiveColor{Light: lipgloss.Color("#D1D5DB"), Dark: lipgloss.Color("#374151")},
			MarkdownListItemColor:        compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")},
			MarkdownListEnumerationColor: compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#8B5CF6")},
			MarkdownImageColor:           compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")},
			MarkdownImageTextColor:       compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")},
			MarkdownCodeBlockColor:       compat.AdaptiveColor{Light: lipgloss.Color("#E0E7FF"), Dark: lipgloss.Color("#1E1B4B")},

			// Syntax highlighting with EvalOps colors
			SyntaxCommentColor:     compat.AdaptiveColor{Light: lipgloss.Color("#6B7280"), Dark: lipgloss.Color("#9CA3AF")},
			SyntaxKeywordColor:     compat.AdaptiveColor{Light: lipgloss.Color("#7C3AED"), Dark: lipgloss.Color("#8B5CF6")}, // Purple
			SyntaxFunctionColor:    compat.AdaptiveColor{Light: lipgloss.Color("#4F46E5"), Dark: lipgloss.Color("#6366F1")}, // Indigo
			SyntaxVariableColor:    compat.AdaptiveColor{Light: lipgloss.Color("#0891B2"), Dark: lipgloss.Color("#06B6D4")}, // Cyan
			SyntaxStringColor:      compat.AdaptiveColor{Light: lipgloss.Color("#059669"), Dark: lipgloss.Color("#10B981")}, // Emerald
			SyntaxNumberColor:      compat.AdaptiveColor{Light: lipgloss.Color("#D97706"), Dark: lipgloss.Color("#F59E0B")}, // Amber
			SyntaxTypeColor:        compat.AdaptiveColor{Light: lipgloss.Color("#DC2626"), Dark: lipgloss.Color("#F472B6")}, // Pink
			SyntaxOperatorColor:    compat.AdaptiveColor{Light: lipgloss.Color("#6366F1"), Dark: lipgloss.Color("#818CF8")}, // Light indigo
			SyntaxPunctuationColor: compat.AdaptiveColor{Light: lipgloss.Color("#6B7280"), Dark: lipgloss.Color("#9CA3AF")},
		},
	}

	return theme
}

func (t *EvalOpsTheme) Name() string {
	return t.name
}

// EvalOpsBranding provides branded UI elements
type EvalOpsBranding struct{}

// Logo returns the EvalOps logo string
func (b *EvalOpsBranding) Logo() string {
	return "🎯"
}

// Title returns the EvalOps title
func (b *EvalOpsBranding) Title() string {
	return "EvalOps"
}

// Tagline returns the EvalOps tagline
func (b *EvalOpsBranding) Tagline() string {
	return "Trust, but Verify™"
}

// FullBrand returns the full brand string
func (b *EvalOpsBranding) FullBrand() string {
	return b.Logo() + " " + b.Title() + " - " + b.Tagline()
}

// ASCII returns the ASCII art logo
func (b *EvalOpsBranding) ASCII() string {
	return `
███████╗██╗   ██╗ █████╗ ██╗      ██████╗ ██████╗ ███████╗
██╔════╝██║   ██║██╔══██╗██║     ██╔═══██╗██╔══██╗██╔════╝
█████╗  ██║   ██║███████║██║     ██║   ██║██████╔╝███████╗
██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ██║   ██║██╔═══╝ ╚════██║
███████╗ ╚████╔╝ ██║  ██║███████╗╚██████╔╝██║     ███████║
╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝     ╚══════╝

                 Trust, but Verify™
`
}

// WelcomeMessage returns the welcome message
func (b *EvalOpsBranding) WelcomeMessage() string {
	return `Welcome to EvalOps - Continuous Evaluation for AI-Generated Code

EvalOps provides real-time quality assurance and evaluation for your AI coding sessions.
Every piece of generated code is automatically evaluated against your quality standards.

Press ? for help or start typing to begin a new evaluation-aware session.`
}

var Branding = &EvalOpsBranding{}

// Register the theme on package initialization
func init() {
	RegisterTheme("evalops", NewEvalOpsTheme())
	RegisterTheme("evalops-light", NewEvalOpsLightTheme())
}

// NewEvalOpsLightTheme creates a light variant of the EvalOps theme
func NewEvalOpsLightTheme() *EvalOpsTheme {
	theme := NewEvalOpsTheme()
	theme.name = "evalops-light"

	// Swap light and dark for light theme
	theme.BackgroundColor = compat.AdaptiveColor{Light: lipgloss.Color("#FFFFFF"), Dark: lipgloss.Color("#FAFAFA")}
	theme.BackgroundPanelColor = compat.AdaptiveColor{Light: lipgloss.Color("#F5F5FF"), Dark: lipgloss.Color("#F0F0FF")}
	theme.BackgroundElementColor = compat.AdaptiveColor{Light: lipgloss.Color("#E8E8FF"), Dark: lipgloss.Color("#E0E0FF")}

	return theme
}