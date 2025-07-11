//go:build windows
// +build windows

package input

import (
	"fmt"
	"io"
	"os"
	"sync"

	xwindows "github.com/charmbracelet/x/windows"
	"github.com/muesli/cancelreader"
	"golang.org/x/sys/windows"
)

type conInputReader struct {
	cancelMixin
	conin        windows.Handle
	originalMode uint32
}

var _ cancelreader.CancelReader = &conInputReader{}

func newCancelreader(r io.Reader, flags int) (cancelreader.CancelReader, error) {
	fallback := func(io.Reader) (cancelreader.CancelReader, error) {
		return cancelreader.NewReader(r)
	}

	var dummy uint32
	if f, ok := r.(cancelreader.File); !ok || f.Fd() != os.Stdin.Fd() ||
		// If data was piped to the standard input, it does not emit events
		// anymore. We can detect this if the console mode cannot be set anymore,
		// in this case, we fallback to the default cancelreader implementation.
		windows.GetConsoleMode(windows.Handle(f.Fd()), &dummy) != nil {
		return fallback(r)
	}

	conin, err := windows.GetStdHandle(windows.STD_INPUT_HANDLE)
	if err != nil {
		return fallback(r)
	}

	// Discard any pending input events.
	if err := xwindows.FlushConsoleInputBuffer(conin); err != nil {
		return fallback(r)
	}

	modes := []uint32{
		windows.ENABLE_WINDOW_INPUT,
		windows.ENABLE_EXTENDED_FLAGS,
	}

	// Enabling mouse mode implicitly blocks console text selection. Thus, we
	// need to enable it only if the mouse mode is requested.
	// In order to toggle mouse mode, the caller must recreate the reader with
	// the appropriate flag toggled.
	if flags&FlagMouseMode != 0 {
		modes = append(modes, windows.ENABLE_MOUSE_INPUT)
	}

	originalMode, err := prepareConsole(conin, modes...)
	if err != nil {
		return nil, fmt.Errorf("failed to prepare console input: %w", err)
	}

	return &conInputReader{
		conin:        conin,
		originalMode: originalMode,
	}, nil
}

// Cancel implements cancelreader.CancelReader.
func (r *conInputReader) Cancel() bool {
	r.setCanceled()

	return windows.CancelIoEx(r.conin, nil) == nil || windows.CancelIo(r.conin) == nil
}

// Close implements cancelreader.CancelReader.
func (r *conInputReader) Close() error {
	if r.originalMode != 0 {
		err := windows.SetConsoleMode(r.conin, r.originalMode)
		if err != nil {
			return fmt.Errorf("reset console mode: %w", err)
		}
	}

	return nil
}

// Read implements cancelreader.CancelReader.
func (r *conInputReader) Read(data []byte) (int, error) {
	if r.isCanceled() {
		return 0, cancelreader.ErrCanceled
	}

	var n uint32
	if err := windows.ReadFile(r.conin, data, &n, nil); err != nil {
		return int(n), fmt.Errorf("read console input: %w", err)
	}

	return int(n), nil
}

func prepareConsole(input windows.Handle, modes ...uint32) (originalMode uint32, err error) {
	err = windows.GetConsoleMode(input, &originalMode)
	if err != nil {
		return 0, fmt.Errorf("get console mode: %w", err)
	}

	var newMode uint32
	for _, mode := range modes {
		newMode |= mode
	}

	err = windows.SetConsoleMode(input, newMode)
	if err != nil {
		return 0, fmt.Errorf("set console mode: %w", err)
	}

	return originalMode, nil
}

// cancelMixin represents a goroutine-safe cancelation status.
type cancelMixin struct {
	unsafeCanceled bool
	lock           sync.Mutex
}

func (c *cancelMixin) setCanceled() {
	c.lock.Lock()
	defer c.lock.Unlock()

	c.unsafeCanceled = true
}

func (c *cancelMixin) isCanceled() bool {
	c.lock.Lock()
	defer c.lock.Unlock()

	return c.unsafeCanceled
}
