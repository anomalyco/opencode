package chat

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/commands"
	"github.com/sst/opencode/internal/components/diff"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/internal/util"
	"github.com/tidwall/gjson"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

type blockRenderer struct {
	textColor        compat.AdaptiveColor
	border           bool
	borderColor      *compat.AdaptiveColor
	borderColorRight bool
	paddingTop       int
	paddingBottom    int
	paddingLeft      int
	paddingRight     int
	marginTop        int
	marginBottom     int
}

type renderingOption func(*blockRenderer)

func WithTextColor(color compat.AdaptiveColor) renderingOption {
	return func(c *blockRenderer) {
		c.textColor = color
	}
}

func WithNoBorder() renderingOption {
	return func(c *blockRenderer) {
		c.border = false
	}
}

func WithBorderColor(color compat.AdaptiveColor) renderingOption {
	return func(c *blockRenderer) {
		c.borderColor = &color
	}
}

func WithBorderColorRight(color compat.AdaptiveColor) renderingOption {
	return func(c *blockRenderer) {
		c.borderColorRight = true
		c.borderColor = &color
	}
}

func WithMarginTop(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.marginTop = padding
	}
}

func WithMarginBottom(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.marginBottom = padding
	}
}

func WithPadding(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.paddingTop = padding
		c.paddingBottom = padding
		c.paddingLeft = padding
		c.paddingRight = padding
	}
}

func WithPaddingLeft(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.paddingLeft = padding
	}
}

func WithPaddingRight(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.paddingRight = padding
	}
}

func WithPaddingTop(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.paddingTop = padding
	}
}

func WithPaddingBottom(padding int) renderingOption {
	return func(c *blockRenderer) {
		c.paddingBottom = padding
	}
}

func renderContentBlock(
	app *app.App,
	content string,
	highlight bool,
	width int,
	options ...renderingOption,
) string {
	t := theme.CurrentTheme()
	renderer := &blockRenderer{
		textColor:     t.TextMuted(),
		border:        true,
		paddingTop:    1,
		paddingBottom: 1,
		paddingLeft:   2,
		paddingRight:  2,
	}
	for _, option := range options {
		option(renderer)
	}

	borderColor := t.BackgroundPanel()
	if renderer.borderColor != nil {
		borderColor = *renderer.borderColor
	}

	style := styles.NewStyle().
		Foreground(renderer.textColor).
		Background(t.BackgroundPanel()).
		Width(width).
		PaddingTop(renderer.paddingTop).
		PaddingBottom(renderer.paddingBottom).
		PaddingLeft(renderer.paddingLeft).
		PaddingRight(renderer.paddingRight).
		AlignHorizontal(lipgloss.Left)

	if renderer.border {
		style = style.
			BorderStyle(lipgloss.ThickBorder()).
			BorderLeft(true).
			BorderRight(true).
			BorderLeftForeground(borderColor).
			BorderLeftBackground(t.Background()).
			BorderRightForeground(t.BackgroundPanel()).
			BorderRightBackground(t.Background())

		if renderer.borderColorRight {
			style = style.
				BorderLeftBackground(t.Background()).
				BorderLeftForeground(t.BackgroundPanel()).
				BorderRightForeground(borderColor).
				BorderRightBackground(t.Background())
		}

		if highlight {
			style = style.
				BorderLeftForeground(borderColor).
				BorderRightForeground(borderColor)
		}
	}

	if highlight {
		style = style.
			Foreground(t.Text()).
			Background(t.BackgroundElement()).
			Bold(true)
	}

	content = style.Render(content)
	if renderer.marginTop > 0 {
		for range renderer.marginTop {
			content = "\n" + content
		}
	}
	if renderer.marginBottom > 0 {
		for range renderer.marginBottom {
			content = content + "\n"
		}
	}

	if highlight {
		copy := app.Key(commands.MessagesCopyCommand)
		// revert := app.Key(commands.MessagesRevertCommand)

		background := t.Background()
		header := layout.Render(
			layout.FlexOptions{
				Background: &background,
				Direction:  layout.Row,
				Justify:    layout.JustifyCenter,
				Align:      layout.AlignStretch,
				Width:      width - 2,
				Gap:        5,
			},
			layout.FlexItem{
				View: copy,
			},
			// layout.FlexItem{
			// 	View: revert,
			// },
		)
		header = styles.NewStyle().Background(t.Background()).Padding(0, 1).Render(header)

		content = "\n\n\n" + header + "\n\n" + content + "\n\n\n"
	}

	return content
}

func renderText(
	app *app.App,
	message opencode.Message,
	text string,
	author string,
	showToolDetails bool,
	highlight bool,
	width int,
	extra string,
	toolCalls ...opencode.ToolInvocationPart,
) string {
	t := theme.CurrentTheme()

	timestamp := time.UnixMilli(int64(message.Metadata.Time.Created)).
		Local().
		Format("02 Jan 2006 03:04 PM")
	if time.Now().Format("02 Jan 2006") == timestamp[:11] {
		// don't show the date if it's today
		timestamp = timestamp[12:]
	}
	info := fmt.Sprintf("%s (%s)", author, timestamp)
	info = styles.NewStyle().Foreground(t.TextMuted()).Render(info)

	backgroundColor := t.BackgroundPanel()
	if highlight {
		backgroundColor = t.BackgroundElement()
	}
	messageStyle := styles.NewStyle().Background(backgroundColor)
	if message.Role == opencode.MessageRoleUser {
		messageStyle = messageStyle.Width(width - 6)
	}

	content := messageStyle.Render(text)
	if message.Role == opencode.MessageRoleAssistant {
		content = util.ToMarkdown(text, width, backgroundColor)
	}

	if !showToolDetails && toolCalls != nil && len(toolCalls) > 0 {
		content = content + "\n\n"
		for _, toolCall := range toolCalls {
			title := renderToolTitle(toolCall, message.Metadata, width)
			metadata := opencode.MessageMetadataTool{}
			if _, ok := message.Metadata.Tool[toolCall.ToolInvocation.ToolCallID]; ok {
				metadata = message.Metadata.Tool[toolCall.ToolInvocation.ToolCallID]
			}
			style := styles.NewStyle()
			if _, ok := metadata.ExtraFields["error"]; ok {
				style = style.Foreground(t.Error())
			}
			title = style.Render(title)
			title = "∟ " + title + "\n"
			content = content + title
		}
	}

	sections := []string{content, info}
	if extra != "" {
		sections = append(sections, "\n"+extra)
	}
	content = strings.Join(sections, "\n")

	switch message.Role {
	case opencode.MessageRoleUser:
		return renderContentBlock(
			app,
			content,
			highlight,
			width,
			WithTextColor(t.Text()),
			WithBorderColorRight(t.Secondary()),
		)
	case opencode.MessageRoleAssistant:
		return renderContentBlock(
			app,
			content,
			highlight,
			width,
			WithBorderColor(t.Accent()),
		)
	}
	return ""
}

func renderToolDetails(
	app *app.App,
	toolCall opencode.ToolInvocationPart,
	messageMetadata opencode.MessageMetadata,
	highlight bool,
	width int,
) string {
	ignoredTools := []string{"todoread"}
	if slices.Contains(ignoredTools, toolCall.ToolInvocation.ToolName) {
		return ""
	}

	toolCallID := toolCall.ToolInvocation.ToolCallID
	metadata := opencode.MessageMetadataTool{}
	if _, ok := messageMetadata.Tool[toolCallID]; ok {
		metadata = messageMetadata.Tool[toolCallID]
	}

	var result *string
	if toolCall.ToolInvocation.Result != "" {
		result = &toolCall.ToolInvocation.Result
	}

	if toolCall.ToolInvocation.State == "partial-call" {
		title := renderToolTitle(toolCall, messageMetadata, width)
		return renderContentBlock(app, title, highlight, width)
	}

	toolArgsMap := make(map[string]any)
	if toolCall.ToolInvocation.Args != nil {
		value := toolCall.ToolInvocation.Args
		if m, ok := value.(map[string]any); ok {
			toolArgsMap = m
			keys := make([]string, 0, len(toolArgsMap))
			for key := range toolArgsMap {
				keys = append(keys, key)
			}
			slices.Sort(keys)
		}
	}

	body := ""
	finished := result != nil && *result != ""
	t := theme.CurrentTheme()
	backgroundColor := t.BackgroundPanel()
	borderColor := t.BackgroundPanel()
	if highlight {
		backgroundColor = t.BackgroundElement()
		borderColor = t.BorderActive()
	}

	switch toolCall.ToolInvocation.ToolName {
	case "read":
		preview := metadata.ExtraFields["preview"]
		if preview != nil && toolArgsMap["filePath"] != nil {
			filename := toolArgsMap["filePath"].(string)
			body = preview.(string)
			body = util.RenderFile(filename, body, width, util.WithTruncate(6))
		}
	case "edit":
		if filename, ok := toolArgsMap["filePath"].(string); ok {
			diffField := metadata.ExtraFields["diff"]
			if diffField != nil {
				patch := diffField.(string)
				var formattedDiff string
				formattedDiff, _ = diff.FormatUnifiedDiff(
					filename,
					patch,
					diff.WithWidth(width-2),
				)
				body = strings.TrimSpace(formattedDiff)
				style := styles.NewStyle().
					Background(backgroundColor).
					Foreground(t.TextMuted()).
					Padding(1, 2).
					Width(width - 4)
				if highlight {
					style = style.Foreground(t.Text()).Bold(true)
				}

				if diagnostics := renderDiagnostics(metadata, filename); diagnostics != "" {
					diagnostics = style.Render(diagnostics)
					body += "\n" + diagnostics
				}

				title := renderToolTitle(toolCall, messageMetadata, width)
				title = style.Render(title)
				content := title + "\n" + body
				content = renderContentBlock(
					app,
					content,
					highlight,
					width,
					WithPadding(0),
					WithBorderColor(borderColor),
				)
				return content
			}
		}
	case "write":
		if filename, ok := toolArgsMap["filePath"].(string); ok {
			if content, ok := toolArgsMap["content"].(string); ok {
				body = util.RenderFile(filename, content, width)
				if diagnostics := renderDiagnostics(metadata, filename); diagnostics != "" {
					body += "\n\n" + diagnostics
				}
			}
		}
	case "bash":
		stdout := metadata.ExtraFields["stdout"]
		if stdout != nil {
			command := toolArgsMap["command"].(string)
			body = fmt.Sprintf("```console\n> %s\n%s```", command, stdout)
			body = util.ToMarkdown(body, width, backgroundColor)
		}
	case "webfetch":
		if format, ok := toolArgsMap["format"].(string); ok && result != nil {
			body = *result
			body = util.TruncateHeight(body, 10)
			if format == "html" || format == "markdown" {
				body = util.ToMarkdown(body, width, backgroundColor)
			}
		}
	case "todowrite":
		todos := metadata.JSON.ExtraFields["todos"]
		if !todos.IsNull() && finished {
			strTodos := todos.Raw()
			todos := gjson.Parse(strTodos)
			for _, todo := range todos.Array() {
				content := todo.Get("content").String()
				switch todo.Get("status").String() {
				case "completed":
					body += fmt.Sprintf("- [x] %s\n", content)
				// case "in-progress":
				// 	body += fmt.Sprintf("- [ ] %s\n", content)
				default:
					body += fmt.Sprintf("- [ ] %s\n", content)
				}
			}
			body = util.ToMarkdown(body, width, backgroundColor)
		}
	case "task":
		summary := metadata.JSON.ExtraFields["summary"]
		if !summary.IsNull() {
			strValue := summary.Raw()
			toolcalls := gjson.Parse(strValue).Array()

			steps := []string{}
			for _, toolcall := range toolcalls {
				call := toolcall.Value().(map[string]any)
				if toolInvocation, ok := call["toolInvocation"].(map[string]any); ok {
					data, _ := json.Marshal(toolInvocation)
					var toolCall opencode.ToolInvocationPart
					_ = json.Unmarshal(data, &toolCall)

					if metadata, ok := call["metadata"].(map[string]any); ok {
						data, _ = json.Marshal(metadata)
						var toolMetadata opencode.MessageMetadataTool
						_ = json.Unmarshal(data, &toolMetadata)

						step := renderToolTitle(toolCall, messageMetadata, width)
						step = "∟ " + step
						steps = append(steps, step)
					}
				}
			}
			body = strings.Join(steps, "\n")
		}
	default:
		if result == nil {
			empty := ""
			result = &empty
		}
		body = *result
		body = util.TruncateHeight(body, 10)
	}

	error := ""
	if err, ok := metadata.ExtraFields["error"].(bool); ok && err {
		if message, ok := metadata.ExtraFields["message"].(string); ok {
			error = message
		}
	}

	if error != "" {
		body = styles.NewStyle().
			Foreground(t.Error()).
			Background(backgroundColor).
			Render(error)
	}

	if body == "" && error == "" && result != nil {
		body = *result
		body = util.TruncateHeight(body, 10)
	}

	title := renderToolTitle(toolCall, messageMetadata, width)
	content := title + "\n\n" + body
	return renderContentBlock(app, content, highlight, width, WithBorderColor(borderColor))
}

func renderToolName(name string) string {
	switch name {
	case "webfetch":
		return "Fetch"
	case "todowrite", "todoread":
		return "Plan"
	default:
		normalizedName := name
		if after, ok := strings.CutPrefix(name, "opencode_"); ok {
			normalizedName = after
		}
		return cases.Title(language.Und).String(normalizedName)
	}
}

func renderToolTitle(
	toolCall opencode.ToolInvocationPart,
	messageMetadata opencode.MessageMetadata,
	width int,
) string {
	// TODO: handle truncate to width

	if toolCall.ToolInvocation.State == "partial-call" {
		return renderToolAction(toolCall.ToolInvocation.ToolName)
	}

	toolArgs := ""
	toolArgsMap := make(map[string]any)
	if toolCall.ToolInvocation.Args != nil {
		value := toolCall.ToolInvocation.Args
		if m, ok := value.(map[string]any); ok {
			toolArgsMap = m

			keys := make([]string, 0, len(toolArgsMap))
			for key := range toolArgsMap {
				keys = append(keys, key)
			}
			slices.Sort(keys)
			firstKey := ""
			if len(keys) > 0 {
				firstKey = keys[0]
			}

			toolArgs = renderArgs(&toolArgsMap, firstKey)
		}
	}

	title := renderToolName(toolCall.ToolInvocation.ToolName)
	switch toolCall.ToolInvocation.ToolName {
	case "read":
		toolArgs = renderArgs(&toolArgsMap, "filePath")
		title = fmt.Sprintf("%s %s", title, toolArgs)
	case "edit", "write":
		if filename, ok := toolArgsMap["filePath"].(string); ok {
			title = fmt.Sprintf("%s %s", title, util.Relative(filename))
		}
	case "bash", "task":
		if description, ok := toolArgsMap["description"].(string); ok {
			title = fmt.Sprintf("%s %s", title, description)
		}
	case "webfetch":
		toolArgs = renderArgs(&toolArgsMap, "url")
		title = fmt.Sprintf("%s %s", title, toolArgs)
	case "todowrite", "todoread":
		// title is just the tool name
	default:
		toolName := renderToolName(toolCall.ToolInvocation.ToolName)
		title = fmt.Sprintf("%s %s", toolName, toolArgs)
	}
	return title
}

func renderToolAction(name string) string {
	switch name {
	case "task":
		return "Searching..."
	case "bash":
		return "Writing command..."
	case "edit":
		return "Preparing edit..."
	case "webfetch":
		return "Fetching from the web..."
	case "glob":
		return "Finding files..."
	case "grep":
		return "Searching content..."
	case "list":
		return "Listing directory..."
	case "read":
		return "Reading file..."
	case "write":
		return "Preparing write..."
	case "todowrite", "todoread":
		return "Planning..."
	case "patch":
		return "Preparing patch..."
	}
	return "Working..."
}

func renderArgs(args *map[string]any, titleKey string) string {
	if args == nil || len(*args) == 0 {
		return ""
	}

	keys := make([]string, 0, len(*args))
	for key := range *args {
		keys = append(keys, key)
	}
	slices.Sort(keys)

	title := ""
	parts := []string{}
	for _, key := range keys {
		value := (*args)[key]
		if value == nil {
			continue
		}
		if key == "filePath" || key == "path" {
			value = util.Relative(value.(string))
		}
		if key == titleKey {
			title = fmt.Sprintf("%s", value)
			continue
		}
		parts = append(parts, fmt.Sprintf("%s=%v", key, value))
	}
	if len(parts) == 0 {
		return title
	}
	return fmt.Sprintf("%s (%s)", title, strings.Join(parts, ", "))
}

// Diagnostic represents an LSP diagnostic
type Diagnostic struct {
	Range struct {
		Start struct {
			Line      int `json:"line"`
			Character int `json:"character"`
		} `json:"start"`
	} `json:"range"`
	Severity int    `json:"severity"`
	Message  string `json:"message"`
}

// renderDiagnostics formats LSP diagnostics for display in the TUI
func renderDiagnostics(metadata opencode.MessageMetadataTool, filePath string) string {
	if diagnosticsData, ok := metadata.ExtraFields["diagnostics"].(map[string]any); ok {
		if fileDiagnostics, ok := diagnosticsData[filePath].([]any); ok {
			var errorDiagnostics []string
			for _, diagInterface := range fileDiagnostics {
				diagMap, ok := diagInterface.(map[string]any)
				if !ok {
					continue
				}
				// Parse the diagnostic
				var diag Diagnostic
				diagBytes, err := json.Marshal(diagMap)
				if err != nil {
					continue
				}
				if err := json.Unmarshal(diagBytes, &diag); err != nil {
					continue
				}
				// Only show error diagnostics (severity === 1)
				if diag.Severity != 1 {
					continue
				}
				line := diag.Range.Start.Line + 1        // 1-based
				column := diag.Range.Start.Character + 1 // 1-based
				errorDiagnostics = append(
					errorDiagnostics,
					fmt.Sprintf("Error [%d:%d] %s", line, column, diag.Message),
				)
			}
			if len(errorDiagnostics) == 0 {
				return ""
			}
			t := theme.CurrentTheme()
			var result strings.Builder
			for _, diagnostic := range errorDiagnostics {
				if result.Len() > 0 {
					result.WriteString("\n")
				}
				result.WriteString(styles.NewStyle().Foreground(t.Error()).Render(diagnostic))
			}
			return result.String()
		}
	}
	return ""

	// diagnosticsData should be a map[string][]Diagnostic
	// strDiagnosticsData := diagnosticsData.Raw()
	// diagnosticsMap := gjson.Parse(strDiagnosticsData).Value().(map[string]any)
	// fileDiagnostics, ok := diagnosticsMap[filePath]
	// if !ok {
	// 	return ""
	// }

	// diagnosticsList, ok := fileDiagnostics.([]any)
	// if !ok {
	// 	return ""
	// }

}
