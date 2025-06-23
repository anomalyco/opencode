package chat

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/charmbracelet/lipgloss/v2"
	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/charmbracelet/x/ansi"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/diff"
	"github.com/sst/opencode/internal/layout"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
	"github.com/sst/opencode/pkg/client"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

func toMarkdown(content string, width int, backgroundColor compat.AdaptiveColor) string {
	r := styles.GetMarkdownRenderer(width, backgroundColor)
	content = strings.ReplaceAll(content, app.RootPath+"/", "")
	rendered, _ := r.Render(content)
	lines := strings.Split(rendered, "\n")

	if len(lines) > 0 {
		firstLine := lines[0]
		cleaned := ansi.Strip(firstLine)
		nospace := strings.ReplaceAll(cleaned, " ", "")
		if nospace == "" {
			lines = lines[1:]
		}
		if len(lines) > 0 {
			lastLine := lines[len(lines)-1]
			cleaned = ansi.Strip(lastLine)
			nospace = strings.ReplaceAll(cleaned, " ", "")
			if nospace == "" {
				lines = lines[:len(lines)-1]
			}
		}
	}
	content = strings.Join(lines, "\n")
	return strings.TrimSuffix(content, "\n")
}

type blockRenderer struct {
	align         *lipgloss.Position
	borderColor   *compat.AdaptiveColor
	fullWidth     bool
	paddingTop    int
	paddingBottom int
	paddingLeft   int
	paddingRight  int
	marginTop     int
	marginBottom  int
}

type renderingOption func(*blockRenderer)

func WithFullWidth() renderingOption {
	return func(c *blockRenderer) {
		c.fullWidth = true
	}
}

func WithAlign(align lipgloss.Position) renderingOption {
	return func(c *blockRenderer) {
		c.align = &align
	}
}

func WithBorderColor(color compat.AdaptiveColor) renderingOption {
	return func(c *blockRenderer) {
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

func renderContentBlock(content string, options ...renderingOption) string {
	t := theme.CurrentTheme()
	renderer := &blockRenderer{
		fullWidth:     false,
		paddingTop:    1,
		paddingBottom: 1,
		paddingLeft:   2,
		paddingRight:  2,
	}
	for _, option := range options {
		option(renderer)
	}

	style := styles.BaseStyle().
		// MarginTop(renderer.marginTop).
		// MarginBottom(renderer.marginBottom).
		PaddingTop(renderer.paddingTop).
		PaddingBottom(renderer.paddingBottom).
		PaddingLeft(renderer.paddingLeft).
		PaddingRight(renderer.paddingRight).
		Background(t.BackgroundPanel()).
		Foreground(t.TextMuted()).
		BorderStyle(lipgloss.ThickBorder())

	align := lipgloss.Left
	if renderer.align != nil {
		align = *renderer.align
	}

	borderColor := t.BackgroundPanel()
	if renderer.borderColor != nil {
		borderColor = *renderer.borderColor
	}

	switch align {
	case lipgloss.Left:
		style = style.
			BorderLeft(true).
			BorderRight(true).
			AlignHorizontal(align).
			BorderLeftForeground(borderColor).
			BorderLeftBackground(t.Background()).
			BorderRightForeground(t.BackgroundPanel()).
			BorderRightBackground(t.Background())
	case lipgloss.Right:
		style = style.
			BorderRight(true).
			BorderLeft(true).
			AlignHorizontal(align).
			BorderRightForeground(borderColor).
			BorderRightBackground(t.Background()).
			BorderLeftForeground(t.BackgroundPanel()).
			BorderLeftBackground(t.Background())
	}

	if renderer.fullWidth {
		style = style.Width(layout.Current.Container.Width)
	}
	content = style.Render(content)
	content = lipgloss.PlaceHorizontal(
		layout.Current.Container.Width,
		align,
		content,
		lipgloss.WithWhitespaceStyle(lipgloss.NewStyle().Background(t.Background())),
	)
	content = lipgloss.PlaceHorizontal(
		layout.Current.Viewport.Width,
		lipgloss.Center,
		content,
		lipgloss.WithWhitespaceStyle(lipgloss.NewStyle().Background(t.Background())),
	)
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

	return content
}

func calculatePadding() int {
	if layout.Current.Viewport.Width < 80 {
		return 5
	} else if layout.Current.Viewport.Width < 120 {
		return 15
	} else {
		return 20
	}
}

func renderText(message client.MessageInfo, text string, author string) string {
	t := theme.CurrentTheme()
	width := layout.Current.Container.Width
	padding := calculatePadding()

	timestamp := time.UnixMilli(int64(message.Metadata.Time.Created)).Local().Format("02 Jan 2006 03:04 PM")
	if time.Now().Format("02 Jan 2006") == timestamp[:11] {
		// don't show the date if it's today
		timestamp = timestamp[12:]
	}
	info := fmt.Sprintf("%s (%s)", author, timestamp)

	textWidth := max(lipgloss.Width(text), lipgloss.Width(info))
	markdownWidth := min(textWidth, width-padding-4) // -4 for the border and padding
	if message.Role == client.Assistant {
		markdownWidth = width - padding - 4 - 2
	}
	if message.Role == client.User {
		text = strings.ReplaceAll(text, "<", "\\<")
		text = strings.ReplaceAll(text, ">", "\\>")
	}
	content := toMarkdown(text, markdownWidth, t.BackgroundPanel())
	content = strings.Join([]string{content, info}, "\n")

	switch message.Role {
	case client.User:
		return renderContentBlock(content,
			WithAlign(lipgloss.Right),
			WithBorderColor(t.Secondary()),
		)
	case client.Assistant:
		return renderContentBlock(content,
			WithAlign(lipgloss.Left),
			WithBorderColor(t.Accent()),
		)
	}
	return ""
}

func renderToolInvocation(
	toolCall client.MessageToolInvocationToolCall,
	result *string,
	metadata client.MessageInfo_Metadata_Tool_AdditionalProperties,
	showDetails bool,
	isLast bool,
	contentOnly bool,
) string {
	ignoredTools := []string{"todoread"}
	if slices.Contains(ignoredTools, toolCall.ToolName) {
		return ""
	}

	outerWidth := layout.Current.Container.Width
	innerWidth := outerWidth - 6
	paddingTop := 0
	paddingBottom := 0
	if showDetails {
		paddingTop = 1
		if result == nil || *result == "" {
			paddingBottom = 1
		}
	}

	t := theme.CurrentTheme()
	style := styles.Muted().
		Width(outerWidth).
		Background(t.BackgroundPanel()).
		PaddingTop(paddingTop).
		PaddingBottom(paddingBottom).
		PaddingLeft(2).
		PaddingRight(2).
		BorderLeft(true).
		BorderRight(true).
		BorderBackground(t.Background()).
		BorderForeground(t.BackgroundPanel()).
		BorderStyle(lipgloss.ThickBorder())

	if toolCall.State == "partial-call" {
		title := renderToolAction(toolCall.ToolName)
		if !showDetails {
			title = "∟ " + title
			padding := calculatePadding()
			style := lipgloss.NewStyle().Width(outerWidth - padding - 4).Background(t.BackgroundPanel())
			return renderContentBlock(style.Render(title),
				WithAlign(lipgloss.Left),
				WithBorderColor(t.Accent()),
				WithPaddingTop(0),
				WithPaddingBottom(1),
			)
		}

		style = style.Foreground(t.TextMuted())
		return style.Render(title)
	}

	toolArgs := ""
	toolArgsMap := make(map[string]any)
	if toolCall.Args != nil {
		value := *toolCall.Args
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

	body := ""
	error := ""
	finished := result != nil && *result != ""

	if e, ok := metadata.Get("error"); ok && e.(bool) == true {
		if m, ok := metadata.Get("message"); ok {
			style = style.BorderLeftForeground(t.Error())
			error = styles.BaseStyle().
				Background(t.BackgroundPanel()).
				Foreground(t.Error()).
				Render(m.(string))
			error = renderContentBlock(
				error,
				WithFullWidth(),
				WithBorderColor(t.Error()),
				WithMarginBottom(1),
			)
		}
	}

	title := ""
	switch toolCall.ToolName {
	case "read":
		toolArgs = renderArgs(&toolArgsMap, "filePath")
		title = fmt.Sprintf("READ %s", toolArgs)
		if preview, ok := metadata.Get("preview"); ok && toolArgsMap["filePath"] != nil {
			filename := toolArgsMap["filePath"].(string)
			body = preview.(string)
			body = renderFile(filename, body, WithTruncate(6))
		}
	case "edit":
		if filename, ok := toolArgsMap["filePath"].(string); ok {
			title = fmt.Sprintf("EDIT %s", relative(filename))
			if d, ok := metadata.Get("diff"); ok {
				patch := d.(string)
				var formattedDiff string
				if layout.Current.Viewport.Width < 80 {
					formattedDiff, _ = diff.FormatUnifiedDiff(
						filename,
						patch,
						diff.WithWidth(layout.Current.Container.Width-2),
					)
				} else {
					diffWidth := min(layout.Current.Viewport.Width-2, 120)
					formattedDiff, _ = diff.FormatDiff(filename, patch, diff.WithTotalWidth(diffWidth))
				}
				formattedDiff = strings.TrimSpace(formattedDiff)
				formattedDiff = lipgloss.NewStyle().
					BorderStyle(lipgloss.ThickBorder()).
					BorderBackground(t.Background()).
					BorderForeground(t.BackgroundPanel()).
					BorderLeft(true).
					BorderRight(true).
					Render(formattedDiff)

				if showDetails {
					style = style.Width(lipgloss.Width(formattedDiff))
					title += "\n"
				}

				body = strings.TrimSpace(formattedDiff)
				body = lipgloss.Place(
					layout.Current.Viewport.Width,
					lipgloss.Height(body)+1,
					lipgloss.Center,
					lipgloss.Top,
					body,
					lipgloss.WithWhitespaceStyle(lipgloss.NewStyle().Background(t.Background())),
				)
			}
		}
	case "write":
		if filename, ok := toolArgsMap["filePath"].(string); ok {
			title = fmt.Sprintf("WRITE %s", relative(filename))
			if content, ok := toolArgsMap["content"].(string); ok {
				body = renderFile(filename, content)
			}
		}
	case "bash":
		if description, ok := toolArgsMap["description"].(string); ok {
			title = fmt.Sprintf("SHELL %s", description)
		}
		if stdout, ok := metadata.Get("stdout"); ok {
			command := toolArgsMap["command"].(string)
			stdout := stdout.(string)
			body = fmt.Sprintf("```console\n> %s\n%s```", command, stdout)
			body = toMarkdown(body, innerWidth, t.BackgroundPanel())
			body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
		}
	case "webfetch":
		toolArgs = renderArgs(&toolArgsMap, "url")
		title = fmt.Sprintf("FETCH %s", toolArgs)
		if format, ok := toolArgsMap["format"].(string); ok {
			if result != nil {
				body = *result
				body = truncateHeight(body, 10)
				if format == "html" || format == "markdown" {
					body = toMarkdown(body, innerWidth, t.BackgroundPanel())
				}
				body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
			}
		}
	case "todowrite":
		title = fmt.Sprintf("PLAN")

		if to, ok := metadata.Get("todos"); ok && finished {
			todos := to.([]any)
			for _, todo := range todos {
				t := todo.(map[string]any)
				content := t["content"].(string)
				switch t["status"].(string) {
				case "completed":
					body += fmt.Sprintf("- [x] %s\n", content)
				// case "in-progress":
				// 	body += fmt.Sprintf("- [ ] %s\n", content)
				default:
					body += fmt.Sprintf("- [ ] %s\n", content)
				}
			}
			body = toMarkdown(body, innerWidth, t.BackgroundPanel())
			body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
		}
	case "task":
		if description, ok := toolArgsMap["description"].(string); ok {
			title = fmt.Sprintf("TASK %s", description)
			if summary, ok := metadata.Get("summary"); ok {
				toolcalls := summary.([]any)
				// toolcalls :=

				steps := []string{}
				for _, toolcall := range toolcalls {
					call := toolcall.(map[string]any)
					if toolInvocation, ok := call["toolInvocation"].(map[string]any); ok {
						data, _ := json.Marshal(toolInvocation)
						var toolCall client.MessageToolInvocationToolCall
						_ = json.Unmarshal(data, &toolCall)

						if metadata, ok := call["metadata"].(map[string]any); ok {
							data, _ = json.Marshal(metadata)
							var toolMetadata client.MessageInfo_Metadata_Tool_AdditionalProperties
							_ = json.Unmarshal(data, &toolMetadata)

							step := renderToolInvocation(
								toolCall,
								nil,
								toolMetadata,
								false,
								false,
								true,
							)
							steps = append(steps, step)
						}
					}
				}
				body = strings.Join(steps, "\n")
				body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
			}
		}

	default:
		toolName := renderToolName(toolCall.ToolName)
		title = fmt.Sprintf("%s %s", toolName, toolArgs)
		if result == nil {
			empty := ""
			result = &empty
		}
		body = *result
		body = truncateHeight(body, 10)
		body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
	}

	if contentOnly {
		title = "∟ " + title
		return title
	}

	if !showDetails {
		title = "∟ " + title
		padding := calculatePadding()
		style := lipgloss.NewStyle().Width(outerWidth - padding - 4).Background(t.BackgroundPanel())
		paddingBottom := 0
		if isLast {
			paddingBottom = 1
		}
		return renderContentBlock(style.Render(title),
			WithAlign(lipgloss.Left),
			WithBorderColor(t.Accent()),
			WithPaddingTop(0),
			WithPaddingBottom(paddingBottom),
		)
	}

	if body == "" && error == "" {
		body = *result
		body = truncateHeight(body, 10)
		body = renderContentBlock(body, WithFullWidth(), WithMarginBottom(1))
	}

	content := style.Render(title)
	content = lipgloss.PlaceHorizontal(
		layout.Current.Viewport.Width,
		lipgloss.Center,
		content,
		lipgloss.WithWhitespaceStyle(lipgloss.NewStyle().Background(t.Background())),
	)
	if showDetails && body != "" && error == "" {
		content += "\n" + body
	}
	if showDetails && error != "" {
		content += "\n" + error
	}
	return content
}

func renderToolName(name string) string {
	switch name {
	case "list":
		return "LIST"
	case "webfetch":
		return "FETCH"
	case "todowrite":
		return "PLAN"
	default:
		normalizedName := name
		if strings.HasPrefix(name, "opencode_") {
			normalizedName = strings.TrimPrefix(name, "opencode_")
		}
		return cases.Upper(language.Und).String(normalizedName)
	}
}

type fileRenderer struct {
	filename string
	content  string
	height   int
}

type fileRenderingOption func(*fileRenderer)

func WithTruncate(height int) fileRenderingOption {
	return func(c *fileRenderer) {
		c.height = height
	}
}

func renderFile(filename string, content string, options ...fileRenderingOption) string {
	t := theme.CurrentTheme()
	renderer := &fileRenderer{
		filename: filename,
		content:  content,
	}
	for _, option := range options {
		option(renderer)
	}

	lines := []string{}
	for line := range strings.SplitSeq(content, "\n") {
		line = strings.TrimRightFunc(line, unicode.IsSpace)
		line = strings.ReplaceAll(line, "\t", "  ")
		lines = append(lines, line)
	}
	content = strings.Join(lines, "\n")

	width := layout.Current.Container.Width - 8
	if renderer.height > 0 {
		content = truncateHeight(content, renderer.height)
	}
	content = fmt.Sprintf("```%s\n%s\n```", extension(renderer.filename), content)
	content = toMarkdown(content, width, t.BackgroundPanel())

	return renderContentBlock(content, WithFullWidth(), WithMarginBottom(1))
}

func renderToolAction(name string) string {
	switch name {
	case "task":
		return "Searching..."
	case "bash":
		return "Building command..."
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
	case "batch":
		return "Running batch operations..."
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
			value = relative(value.(string))
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

func truncateHeight(content string, height int) string {
	lines := strings.Split(content, "\n")
	if len(lines) > height {
		return strings.Join(lines[:height], "\n")
	}
	return content
}

func relative(path string) string {
	return strings.TrimPrefix(path, app.RootPath+"/")
}

func extension(path string) string {
	ext := filepath.Ext(path)
	if ext == "" {
		ext = ""
	} else {
		ext = strings.ToLower(ext[1:])
	}
	return ext
}
