package util

import (
	"context"
	"fmt"
	"time"

	"github.com/sst/opencode/internal/clipboard"
)

// SafeClipboard provides panic-safe clipboard operations
type SafeClipboard struct {
	recovery     *PanicRecovery
	errorHandler func(error)
	timeout      time.Duration
}

// NewSafeClipboard creates a new safe clipboard wrapper
func NewSafeClipboard(errorHandler func(error)) *SafeClipboard {
	return &SafeClipboard{
		recovery:     NewPanicRecovery(errorHandler),
		errorHandler: errorHandler,
		timeout:      5 * time.Second, // 5 second timeout for clipboard ops
	}
}

// ReadText safely reads text from clipboard with timeout
func (sc *SafeClipboard) ReadText() []byte {
	ctx, cancel := context.WithTimeout(context.Background(), sc.timeout)
	defer cancel()

	resultChan := make(chan []byte, 1)
	errorChan := make(chan error, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				errorChan <- fmt.Errorf("clipboard read panic: %v", r)
			}
		}()

		result := clipboard.Read(clipboard.FmtText)
		resultChan <- result
	}()

	select {
	case result := <-resultChan:
		return result
	case err := <-errorChan:
		if sc.errorHandler != nil {
			sc.errorHandler(err)
		}
		return nil
	case <-ctx.Done():
		if sc.errorHandler != nil {
			sc.errorHandler(fmt.Errorf("clipboard read timeout after %v", sc.timeout))
		}
		return nil
	}
}

// ReadImage safely reads image from clipboard with timeout
func (sc *SafeClipboard) ReadImage() []byte {
	ctx, cancel := context.WithTimeout(context.Background(), sc.timeout)
	defer cancel()

	resultChan := make(chan []byte, 1)
	errorChan := make(chan error, 1)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				errorChan <- fmt.Errorf("clipboard read panic: %v", r)
			}
		}()

		result := clipboard.Read(clipboard.FmtImage)
		resultChan <- result
	}()

	select {
	case result := <-resultChan:
		return result
	case err := <-errorChan:
		if sc.errorHandler != nil {
			sc.errorHandler(err)
		}
		return nil
	case <-ctx.Done():
		if sc.errorHandler != nil {
			sc.errorHandler(fmt.Errorf("clipboard read timeout after %v", sc.timeout))
		}
		return nil
	}
}

// WriteText safely writes text to clipboard
func (sc *SafeClipboard) WriteText(data []byte) bool {
	success := sc.recovery.SafeExecute(func() {
		clipboard.Write(clipboard.FmtText, data)
	})
	return success
}

// WriteImage safely writes image to clipboard
func (sc *SafeClipboard) WriteImage(data []byte) bool {
	success := sc.recovery.SafeExecute(func() {
		clipboard.Write(clipboard.FmtImage, data)
	})
	return success
}