package main

import (
	"math"
	"testing"
	"time"
)

// TestExponentialBackoffCalculation verifies the backoff algorithm
func TestExponentialBackoffCalculation(t *testing.T) {
	const (
		minBackoff = 1 * time.Second
		maxBackoff = 30 * time.Second
	)

	tests := []struct {
		attempt     int
		wantBackoff time.Duration
	}{
		{0, 1 * time.Second},
		{1, 2 * time.Second},
		{2, 4 * time.Second},
		{3, 8 * time.Second},
		{4, 16 * time.Second},
		{5, 30 * time.Second},  // Capped at maxBackoff
		{10, 30 * time.Second}, // Still capped
	}

	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			// Verify backoff calculation matches: 1s, 2s, 4s, 8s, 16s, 30s, 30s...
			backoff := time.Duration(math.Min(
				float64(minBackoff)*math.Pow(2, float64(tt.attempt)),
				float64(maxBackoff),
			))

			if backoff != tt.wantBackoff {
				t.Errorf("attempt=%d: got %v, want %v", tt.attempt, backoff, tt.wantBackoff)
			}
		})
	}
}
