package completions

import (
	"context"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type filesContextGroup struct {
	app          *app.App
	gitFiles     []CompletionSuggestion
	// Power optimization: Simple caching to reduce API calls
	lastQuery      string
	lastResults    []CompletionSuggestion
	lastQueryTime  time.Time
	cacheTimeout   time.Duration
}

func (cg *filesContextGroup) GetId() string {
	return "files"
}

func (cg *filesContextGroup) GetEmptyMessage() string {
	return "no matching files"
}

func (cg *filesContextGroup) getGitFiles() []CompletionSuggestion {
	items := make([]CompletionSuggestion, 0)

	status, _ := cg.app.Client.File.Status(context.Background())
	if status != nil {
		files := *status
		sort.Slice(files, func(i, j int) bool {
			return files[i].Added+files[i].Removed > files[j].Added+files[j].Removed
		})

		for _, file := range files {
			displayFunc := func(s styles.Style) string {
				t := theme.CurrentTheme()
				green := s.Foreground(t.Success()).Render
				red := s.Foreground(t.Error()).Render
				display := file.Path
				if file.Added > 0 {
					display += green(" +" + strconv.Itoa(int(file.Added)))
				}
				if file.Removed > 0 {
					display += red(" -" + strconv.Itoa(int(file.Removed)))
				}
				return display
			}
			item := CompletionSuggestion{
				Display:    displayFunc,
				Value:      file.Path,
				ProviderID: cg.GetId(),
				RawData:    file,
			}
			items = append(items, item)
		}
	}

	return items
}

func (cg *filesContextGroup) GetChildEntries(
	query string,
) ([]CompletionSuggestion, error) {
	items := make([]CompletionSuggestion, 0)

	query = strings.TrimSpace(query)
	
	// Power optimization: check cache first to reduce API calls
	if query == cg.lastQuery && time.Since(cg.lastQueryTime) < cg.cacheTimeout {
		return cg.lastResults, nil
	}
	
	if query == "" {
		items = append(items, cg.gitFiles...)
	}

	files, err := cg.app.Client.Find.Files(
		context.Background(),
		opencode.FindFilesParams{Query: opencode.F(query)},
	)
	if err != nil {
		slog.Error("Failed to get completion items", "error", err)
		return items, err
	}
	if files == nil {
		// Cache empty result
		cg.lastQuery = query
		cg.lastResults = items
		cg.lastQueryTime = time.Now()
		return items, nil
	}

	for _, file := range *files {
		exists := false
		for _, existing := range cg.gitFiles {
			if existing.Value == file {
				if query != "" {
					items = append(items, existing)
				}
				exists = true
			}
		}
		if !exists {
			displayFunc := func(s styles.Style) string {
				// t := theme.CurrentTheme()
				// return s.Foreground(t.Text()).Render(file)
				return s.Render(file)
			}

			item := CompletionSuggestion{
				Display:    displayFunc,
				Value:      file,
				ProviderID: cg.GetId(),
				RawData:    file,
			}
			items = append(items, item)
		}
	}

	// Power optimization: cache the result
	cg.lastQuery = query
	cg.lastResults = items
	cg.lastQueryTime = time.Now()

	return items, nil
}

func NewFileContextGroup(app *app.App) CompletionProvider {
	cg := &filesContextGroup{
		app: app,
		// Power optimization: cache timeout to reduce API calls
		cacheTimeout: 300 * time.Millisecond, // Don't make new API calls for 300ms
	}
	go func() {
		cg.gitFiles = cg.getGitFiles()
	}()
	return cg
}
