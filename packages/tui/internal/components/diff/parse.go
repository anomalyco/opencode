package diff

import (
	"bufio"
	"fmt"
	"strings"
)

type DiffStats struct {
	Added    int
	Removed  int
	Modified int
}

func ParseStats(diff string) (map[string]DiffStats, error) {
	stats := make(map[string]DiffStats)
	var currentFile string
	scanner := bufio.NewScanner(strings.NewReader(diff))

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "---") {
			continue
		} else if strings.HasPrefix(line, "+++") {
			parts := strings.SplitN(line, " ", 2)
			if len(parts) == 2 {
				currentFile = strings.TrimPrefix(parts[1], "b/")
			}
			continue
		}
		if strings.HasPrefix(line, "@@") {
			continue
		}
		if currentFile == "" {
			continue
		}

		fileStats := stats[currentFile]
		switch {
		case strings.HasPrefix(line, "+"):
			fileStats.Added++
		case strings.HasPrefix(line, "-"):
			fileStats.Removed++
		}
		stats[currentFile] = fileStats
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error reading diff string: %w", err)
	}

	for file, fileStats := range stats {
		fileStats.Modified = fileStats.Added + fileStats.Removed
		stats[file] = fileStats
	}

	return stats, nil
}
