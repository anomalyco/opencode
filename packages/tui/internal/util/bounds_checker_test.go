package util

import (
	"testing"
)

func TestSafeSliceAccess(t *testing.T) {
	slice := []int{1, 2, 3}

	t.Run("valid index", func(t *testing.T) {
		result := SafeSliceAccess(slice, 1, 0)
		if result != 2 {
			t.Errorf("Expected 2, got %d", result)
		}
	})

	t.Run("negative index", func(t *testing.T) {
		result := SafeSliceAccess(slice, -1, 0)
		if result != 0 {
			t.Errorf("Expected default value 0, got %d", result)
		}
	})

	t.Run("out of bounds index", func(t *testing.T) {
		result := SafeSliceAccess(slice, 5, 0)
		if result != 0 {
			t.Errorf("Expected default value 0, got %d", result)
		}
	})
}

func TestSafeSliceRange(t *testing.T) {
	slice := []int{1, 2, 3, 4, 5}

	t.Run("valid range", func(t *testing.T) {
		result := SafeSliceRange(slice, 1, 3)
		if len(result) != 2 || result[0] != 2 || result[1] != 3 {
			t.Errorf("Expected [2 3], got %v", result)
		}
	})

	t.Run("negative start", func(t *testing.T) {
		result := SafeSliceRange(slice, -1, 2)
		if len(result) != 2 || result[0] != 1 || result[1] != 2 {
			t.Errorf("Expected [1 2], got %v", result)
		}
	})

	t.Run("end beyond length", func(t *testing.T) {
		result := SafeSliceRange(slice, 3, 10)
		if len(result) != 2 || result[0] != 4 || result[1] != 5 {
			t.Errorf("Expected [4 5], got %v", result)
		}
	})

	t.Run("invalid range", func(t *testing.T) {
		result := SafeSliceRange(slice, 3, 1)
		if len(result) != 0 {
			t.Errorf("Expected empty slice, got %v", result)
		}
	})
}

func TestSafeMessageAccess(t *testing.T) {
	messages := []string{"first", "second", "third"}

	t.Run("valid access", func(t *testing.T) {
		result, ok := SafeMessageAccess(messages, 1)
		if !ok || result != "second" {
			t.Errorf("Expected (second, true), got (%s, %v)", result, ok)
		}
	})

	t.Run("negative index", func(t *testing.T) {
		result, ok := SafeMessageAccess(messages, -1)
		if ok || result != "" {
			t.Errorf("Expected (, false), got (%s, %v)", result, ok)
		}
	})

	t.Run("out of bounds", func(t *testing.T) {
		result, ok := SafeMessageAccess(messages, 5)
		if ok || result != "" {
			t.Errorf("Expected (, false), got (%s, %v)", result, ok)
		}
	})
}

func TestValidateArrayBounds(t *testing.T) {
	t.Run("valid index", func(t *testing.T) {
		err := ValidateArrayBounds(5, 3)
		if err != nil {
			t.Errorf("Expected no error, got %v", err)
		}
	})

	t.Run("negative index", func(t *testing.T) {
		err := ValidateArrayBounds(5, -1)
		if err == nil {
			t.Error("Expected error for negative index, got nil")
		}
	})

	t.Run("out of bounds", func(t *testing.T) {
		err := ValidateArrayBounds(5, 5)
		if err == nil {
			t.Error("Expected error for out of bounds index, got nil")
		}
	})
}
