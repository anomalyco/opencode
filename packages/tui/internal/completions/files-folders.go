package completions

import (
	"context"
	"log/slog"
	"sort"
	"strconv"
	"strings"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/components/dialog"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type filesAndFoldersContextGroup struct {
	app      *app.App
	gitFiles []dialog.CompletionItemI
}

func (cg *filesAndFoldersContextGroup) GetId() string {
	return "files"
}

func (cg *filesAndFoldersContextGroup) GetEmptyMessage() string {
	return "no matching files"
}

func (cg *filesAndFoldersContextGroup) getGitFiles() []dialog.CompletionItemI {
	t := theme.CurrentTheme()
	items := make([]dialog.CompletionItemI, 0)
	base := styles.NewStyle().Background(t.BackgroundElement())
	green := base.Foreground(t.Success()).Render
	red := base.Foreground(t.Error()).Render

	status, _ := cg.app.Client.File.Status(context.Background())
	if status != nil {
		files := *status
		sort.Slice(files, func(i, j int) bool {
			return files[i].Added+files[i].Removed > files[j].Added+files[j].Removed
		})

		for _, file := range files {
			title := file.File
			if file.Added > 0 {
				title += green(" +" + strconv.Itoa(int(file.Added)))
			}
			if file.Removed > 0 {
				title += red(" -" + strconv.Itoa(int(file.Removed)))
			}
			item := dialog.NewCompletionItem(dialog.CompletionItem{
				Title: title,
				Value: file.File,
			})
			items = append(items, item)
		}
	}

	return items
}

func (cg *filesAndFoldersContextGroup) GetChildEntries(
	query string,
) ([]dialog.CompletionItemI, error) {
	items := make([]dialog.CompletionItemI, 0)

	query = strings.TrimSpace(query)
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
		return items, nil
	}

	for _, file := range *files {
		exists := false
		for _, existing := range cg.gitFiles {
			if existing.GetValue() == file {
				if query != "" {
					items = append(items, existing)
				}
				exists = true
			}
		}
		if !exists {
			item := dialog.NewCompletionItem(dialog.CompletionItem{
				Title: file,
				Value: file,
			})
			items = append(items, item)
		}
	}

	return items, nil
}

func NewFileAndFolderContextGroup(app *app.App) dialog.CompletionProvider {
	cg := &filesAndFoldersContextGroup{
		app: app,
	}
	go func() {
		cg.gitFiles = cg.getGitFiles()
	}()
	return cg
}
