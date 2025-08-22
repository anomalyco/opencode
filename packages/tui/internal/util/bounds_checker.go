package util

import (
	"fmt"
	"log/slog"
)

// SafeSliceAccess safely accesses a slice element with bounds checking
func SafeSliceAccess[T any](slice []T, index int, defaultVal T) T {
	if index < 0 || index >= len(slice) {
		slog.Debug("Slice access out of bounds", "index", index, "length", len(slice))
		return defaultVal
	}
	return slice[index]
}

// SafeSliceRange safely creates a slice range with bounds checking
func SafeSliceRange[T any](slice []T, start, end int) []T {
	if start < 0 {
		start = 0
	}
	if end > len(slice) {
		end = len(slice)
	}
	if start > end {
		slog.Debug("Invalid slice range", "start", start, "end", end, "length", len(slice))
		return []T{}
	}
	return slice[start:end]
}

// SafeMessageAccess safely accesses a message by index
func SafeMessageAccess[T any](messages []T, index int) (T, bool) {
	var zero T
	if index < 0 || index >= len(messages) {
		slog.Debug("Message access out of bounds", "index", index, "length", len(messages))
		return zero, false
	}
	return messages[index], true
}

// ValidateArrayBounds validates array bounds before access
func ValidateArrayBounds(length, index int) error {
	if index < 0 {
		return fmt.Errorf("negative index %d", index)
	}
	if index >= length {
		return fmt.Errorf("index %d out of bounds for length %d", index, length)
	}
	return nil
}