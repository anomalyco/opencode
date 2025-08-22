package util

import (
	"fmt"
	"runtime/debug"
)

// PanicRecovery wraps potentially unsafe operations with panic recovery
type PanicRecovery struct {
	ErrorCallback func(error)
}

// NewPanicRecovery creates a new panic recovery wrapper
func NewPanicRecovery(errorCallback func(error)) *PanicRecovery {
	return &PanicRecovery{
		ErrorCallback: errorCallback,
	}
}

// SafeExecute executes a function with panic recovery
// Returns true if execution succeeded, false if panic occurred
func (pr *PanicRecovery) SafeExecute(operation func()) bool {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("panic recovered: %v\nStack trace:\n%s", r, debug.Stack())
			if pr.ErrorCallback != nil {
				pr.ErrorCallback(err)
			}
		}
	}()

	operation()
	return true
}

// SafeExecuteWithResult executes a function with panic recovery and returns result
// Returns (result, success) where success indicates if operation completed without panic
func SafeExecuteWithResult[T any](operation func() T, errorCallback func(error)) (T, bool) {
	var result T
	var success bool

	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("panic recovered: %v\nStack trace:\n%s", r, debug.Stack())
			if errorCallback != nil {
				errorCallback(err)
			}
			success = false
		}
	}()

	result = operation()
	success = true
	return result, success
}

// SafeExecuteWithError executes a function with panic recovery and error handling
// Returns error if panic occurred or operation returned error
func SafeExecuteWithError(operation func() error, errorCallback func(error)) error {
	defer func() {
		if r := recover(); r != nil {
			err := fmt.Errorf("panic recovered: %v\nStack trace:\n%s", r, debug.Stack())
			if errorCallback != nil {
				errorCallback(err)
			}
		}
	}()

	return operation()
}