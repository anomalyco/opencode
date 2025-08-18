package util

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/charmbracelet/lipgloss/v2/compat"
	"github.com/charmbracelet/x/ansi"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

var RootPath string
var CwdPath string

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

func RenderFile(
	filename string,
	content string,
	width int,
	options ...fileRenderingOption) string {
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

	if renderer.height > 0 {
		content = TruncateHeight(content, renderer.height)
	}
	content = fmt.Sprintf("```%s\n%s\n```", Extension(renderer.filename), content)
	content = ToMarkdown(content, width, t.BackgroundPanel())
	return content
}

func TruncateHeight(content string, height int) string {
	lines := strings.Split(content, "\n")
	if len(lines) > height {
		return strings.Join(lines[:height], "\n")
	}
	return content
}

func Relative(path string) string {
	path = strings.TrimPrefix(path, CwdPath+"/")
	return strings.TrimPrefix(path, RootPath+"/")
}

func Extension(path string) string {
	ext := filepath.Ext(path)
	if ext == "" {
		ext = ""
	} else {
		ext = strings.ToLower(ext[1:])
	}
	return ext
}

func ToMarkdown(content string, width int, backgroundColor compat.AdaptiveColor) string {
	r := styles.GetMarkdownRenderer(width-6, backgroundColor)
	content = strings.ReplaceAll(content, RootPath+"/", "")
	hyphenRegex := regexp.MustCompile(`-([^ \-|]|$)`)
	content = hyphenRegex.ReplaceAllString(content, "\u2011$1")
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
	content = strings.ReplaceAll(content, "\u2011", "-")
	return strings.TrimSuffix(content, "\n")
}
