package completions

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/sst/opencode-sdk-go"
	"github.com/sst/opencode/internal/app"
	"github.com/sst/opencode/internal/styles"
	"github.com/sst/opencode/internal/theme"
)

type symbolsContextGroup struct {
	app *app.App
}

func (cg *symbolsContextGroup) GetId() string {
	return "symbols"
}

func (cg *symbolsContextGroup) GetEmptyMessage() string {
	return "no matching symbols"
}

type SymbolKind int

const (
	SymbolKindFile          SymbolKind = 1
	SymbolKindModule        SymbolKind = 2
	SymbolKindNamespace     SymbolKind = 3
	SymbolKindPackage       SymbolKind = 4
	SymbolKindClass         SymbolKind = 5
	SymbolKindMethod        SymbolKind = 6
	SymbolKindProperty      SymbolKind = 7
	SymbolKindField         SymbolKind = 8
	SymbolKindConstructor   SymbolKind = 9
	SymbolKindEnum          SymbolKind = 10
	SymbolKindInterface     SymbolKind = 11
	SymbolKindFunction      SymbolKind = 12
	SymbolKindVariable      SymbolKind = 13
	SymbolKindConstant      SymbolKind = 14
	SymbolKindString        SymbolKind = 15
	SymbolKindNumber        SymbolKind = 16
	SymbolKindBoolean       SymbolKind = 17
	SymbolKindArray         SymbolKind = 18
	SymbolKindObject        SymbolKind = 19
	SymbolKindKey           SymbolKind = 20
	SymbolKindNull          SymbolKind = 21
	SymbolKindEnumMember    SymbolKind = 22
	SymbolKindStruct        SymbolKind = 23
	SymbolKindEvent         SymbolKind = 24
	SymbolKindOperator      SymbolKind = 25
	SymbolKindTypeParameter SymbolKind = 26
)

func (cg *symbolsContextGroup) GetChildEntries(
	query string,
) ([]CompletionSuggestion, error) {
	items := make([]CompletionSuggestion, 0)

	query = strings.TrimSpace(query)
	if query == "" {
		return items, nil
	}

	symbols, err := cg.app.Client.Find.Symbols(
		context.Background(),
		opencode.FindSymbolsParams{Query: opencode.F(query)},
	)
	if err != nil {
		slog.Error("Failed to get symbol completion items", "error", err)
		return items, err
	}
	if symbols == nil {
		return items, nil
	}

	for _, sym := range *symbols {
		parts := strings.Split(sym.Name, ".")
		lastPart := parts[len(parts)-1]
		start := int(sym.Location.Range.Start.Line)
		end := int(sym.Location.Range.End.Line)

		displayFunc := func(s styles.Style) string {
			t := theme.CurrentTheme()
			base := s.Foreground(t.Text()).Render
			muted := s.Foreground(t.TextMuted()).Render
			display := base(lastPart)

			uriParts := strings.Split(sym.Location.Uri, "/")
			lastTwoParts := uriParts[len(uriParts)-2:]
			joined := strings.Join(lastTwoParts, "/")
			display += muted(fmt.Sprintf(" %s", joined))

			display += muted(fmt.Sprintf(":L%d-%d", start, end))
			return display
		}

		value := fmt.Sprintf("%s?start=%d&end=%d", sym.Location.Uri, start, end)

		item := CompletionSuggestion{
			Display:    displayFunc,
			Value:      value,
			ProviderID: cg.GetId(),
			RawData:    sym,
		}
		items = append(items, item)
	}

	return items, nil
}

func NewSymbolsContextGroup(app *app.App) CompletionProvider {
	return &symbolsContextGroup{
		app: app,
	}
}
