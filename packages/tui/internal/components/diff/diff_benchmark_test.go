package diff

import (
	"image/color"
	"testing"
	
	"github.com/charmbracelet/lipgloss/v2"
	"github.com/sst/opencode/internal/theme"
)

// loadBenchmarkTheme loads a theme for benchmarking to prevent nil pointer issues
func loadBenchmarkTheme() {
	if err := theme.LoadThemesFromJSON(); err != nil {
		// Fallback to system theme if loading fails
		testTheme := theme.NewSystemTheme(lipgloss.Color("#000000"), true)
		theme.RegisterTheme("test", testTheme)
		theme.SetTheme("test")
		return
	}

	// Use the actual opencode theme for realistic performance measurements
	if err := theme.SetTheme("opencode"); err != nil {
		// Fallback to first available theme if opencode is not found
		availableThemes := theme.AvailableThemes()
		if len(availableThemes) > 0 {
			theme.SetTheme(availableThemes[0])
		}
	}
}

// BenchmarkUltimateOptimization tests the combination of batch highlighting + syntax caching
func BenchmarkUltimateOptimization(b *testing.B) {
	// Load default theme for realistic testing
	loadBenchmarkTheme()
	
	// Create realistic test data
	testLines := []DiffLine{
		{Kind: LineContext, Content: `package main`},
		{Kind: LineContext, Content: ``},
		{Kind: LineContext, Content: `import (`},
		{Kind: LineContext, Content: `	"fmt"`},
		{Kind: LineRemoved, Content: `	"log"`},
		{Kind: LineAdded, Content: `	"log/slog"`},
		{Kind: LineContext, Content: `	"net/http"`},
		{Kind: LineContext, Content: `)`},
		{Kind: LineContext, Content: ``},
		{Kind: LineContext, Content: `func main() {`},
		{Kind: LineRemoved, Content: `	log.Println("Starting server...")`},
		{Kind: LineAdded, Content: `	slog.Info("Starting server...")`},
		{Kind: LineContext, Content: `	http.HandleFunc("/", handler)`},
		{Kind: LineContext, Content: `	http.ListenAndServe(":8080", nil)`},
		{Kind: LineContext, Content: `}`},
		{Kind: LineContext, Content: ``},
		{Kind: LineContext, Content: `func handler(w http.ResponseWriter, r *http.Request) {`},
		{Kind: LineRemoved, Content: `	fmt.Fprintf(w, "Hello World!")`},
		{Kind: LineAdded, Content: `	fmt.Fprintf(w, "Hello, %s!", r.URL.Path[1:])`},
		{Kind: LineContext, Content: `}`},
	}

	fileName := "main.go"
	bg := color.RGBA{R: 0, G: 0, B: 0, A: 255}

	b.Run("cache_miss_first_render", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// Clear cache to simulate first render
			globalSyntaxHighlighter.cache = NewSyntaxCache(2000)
			_ = preHighlightHunkLines(fileName, testLines, bg)
		}
	})

	b.Run("cache_hit_subsequent_renders", func(b *testing.B) {
		// Pre-warm cache
		_ = preHighlightHunkLines(fileName, testLines, bg)
		
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			// This should be blazing fast - cache hit!
			_ = preHighlightHunkLines(fileName, testLines, bg)
		}
	})

	// Compare with old per-line approach
	b.Run("old_per_line_approach", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			for _, line := range testLines {
				_ = highlightLine(fileName, line.Content, bg)
			}
		}
	})
}

// BenchmarkCacheEfficiency tests cache hit ratios with different content patterns
func BenchmarkCacheEfficiency(b *testing.B) {
	fileName := "test.go"
	bg := color.RGBA{R: 0, G: 0, B: 0, A: 255}

	// Same content (should have 100% cache hit rate after first)
	sameContent := generateTestDiffLines(30, "identical")
	
	b.Run("same_content_cache_hits", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = preHighlightHunkLines(fileName, sameContent, bg)
		}
	})

	// Different content each time (cache misses)
	b.Run("different_content_cache_misses", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			differentContent := generateTestDiffLines(30, string(rune(i))) // Unique each time
			_ = preHighlightHunkLines(fileName, differentContent, bg)
		}
	})
}

// BenchmarkRealWorldDiffScenarios tests performance with realistic diff scenarios
func BenchmarkRealWorldDiffScenarios(b *testing.B) {
	fileName := "src/handler.go"
	bg := color.RGBA{R: 0, G: 0, B: 0, A: 255}

	scenarios := []struct {
		name  string
		lines int
	}{
		{"small_function_change", 15},
		{"medium_file_update", 50},
		{"large_refactor", 150},
	}

	for _, scenario := range scenarios {
		testLines := generateTestDiffLines(scenario.lines, "go-code")
		
		b.Run(scenario.name+"_cache_miss", func(b *testing.B) {
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// Clear cache each time to simulate unique content
				globalSyntaxHighlighter.cache = NewSyntaxCache(2000)
				_ = preHighlightHunkLines(fileName, testLines, bg)
			}
		})

		b.Run(scenario.name+"_cache_hit", func(b *testing.B) {
			// Pre-warm cache
			_ = preHighlightHunkLines(fileName, testLines, bg)
			
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_ = preHighlightHunkLines(fileName, testLines, bg)
			}
		})
	}
}

// generateTestDiffLines creates test diff lines with specified pattern
func generateTestDiffLines(numLines int, pattern string) []DiffLine {
	codeTemplates := []string{
		`func handleRequest(w http.ResponseWriter, r *http.Request) {`,
		`	if r.Method != "POST" {`,
		`		http.Error(w, "Method not allowed", 405)`,
		`		return`,
		`	}`,
		`	var data RequestData`,
		`	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {`,
		`		http.Error(w, err.Error(), 400)`,
		`		return`,
		`	}`,
		`	result := processData(data)`,
		`	json.NewEncoder(w).Encode(result)`,
		`}`,
	}

	lines := make([]DiffLine, 0, numLines)
	
	for i := 0; i < numLines; i++ {
		template := codeTemplates[i%len(codeTemplates)]
		
		// Add pattern to make content unique if needed
		content := template
		if pattern != "identical" {
			content = template + " // " + pattern
		}
		
		var kind LineType
		switch i % 4 {
		case 0:
			kind = LineContext
		case 1:
			kind = LineRemoved
		case 2:
			kind = LineAdded
		default:
			kind = LineContext
		}

		lines = append(lines, DiffLine{
			OldLineNo: i + 1,
			NewLineNo: i + 1,
			Kind:      kind,
			Content:   content,
		})
	}

	return lines
}

// BenchmarkCompleteHunkRenderingOptimized tests end-to-end performance
func BenchmarkCompleteHunkRenderingOptimized(b *testing.B) {
	// Create test hunk with realistic Go code
	testHunk := Hunk{
		Header: "@@ -15,20 +15,22 @@ func main() {",
		Lines:  generateTestDiffLines(40, "optimized"),
	}

	fileName := "main.go"

	b.Run("unified_hunk_with_optimization", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = RenderUnifiedHunk(fileName, testHunk, WithWidth(120))
		}
	})

	b.Run("sidebyside_hunk_with_optimization", func(b *testing.B) {
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			_ = RenderSideBySideHunk(fileName, testHunk, WithWidth(120))
		}
	})
}