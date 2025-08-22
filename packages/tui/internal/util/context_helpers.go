package util

import (
	"context"
	"time"
)

// Common timeout durations for different operations
const (
	ShortTimeout  = 5 * time.Second   // For quick API calls
	MediumTimeout = 30 * time.Second  // For normal operations
	LongTimeout   = 2 * time.Minute   // For long-running operations
)

// WithShortTimeout creates a context with a 5-second timeout
func WithShortTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), ShortTimeout)
}

// WithMediumTimeout creates a context with a 30-second timeout
func WithMediumTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), MediumTimeout)
}

// WithLongTimeout creates a context with a 2-minute timeout
func WithLongTimeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), LongTimeout)
}

// WithCustomTimeout creates a context with a custom timeout
func WithCustomTimeout(timeout time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), timeout)
}