package completions

import (
	"context"
	"log/slog"
	"strings"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type agentsContextGroup struct {
	app *app.App
}

func (cg *agentsContextGroup) GetId() string {
	return "agents"
}

func (cg *agentsContextGroup) GetEmptyMessage() string {
	return "no matching agents"
}

func (cg *agentsContextGroup) GetChildEntries(
	query string,
) ([]CompletionSuggestion, error) {
	items := make([]CompletionSuggestion, 0)

	query = strings.TrimSpace(query)

	agents, err := cg.app.Client.Agent.List(
		context.Background(),
		opencode.AgentListParams{},
	)
	if err != nil {
		slog.Error("Failed to get agent list", "error", err)
		return items, err
	}
	if agents == nil {
		return items, nil
	}

	for _, agent := range *agents {
		if query != "" && !strings.Contains(strings.ToLower(agent.Name), strings.ToLower(query)) {
			continue
		}
		if agent.Mode == opencode.AgentModePrimary {
			continue
		}

		displayFunc := func(s styles.Style) string {
			t := theme.CurrentTheme()
			muted := s.Foreground(t.TextMuted()).Render
			return s.Render(agent.Name) + muted(" (agent)")
		}

		item := CompletionSuggestion{
			Display:    displayFunc,
			Value:      agent.Name,
			ProviderID: cg.GetId(),
			RawData:    agent,
		}
		items = append(items, item)
	}

	return items, nil
}

func NewAgentsContextGroup(app *app.App) CompletionProvider {
	return &agentsContextGroup{
		app: app,
	}
}
