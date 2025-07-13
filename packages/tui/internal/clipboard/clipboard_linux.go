// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build linux

package clipboard

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var (
	// Clipboard tools in order of preference
	clipboardTools = []struct {
		name      string
		readCmd   []string
		writeCmd  []string
		readImg   []string
		writeImg  []string
		available bool
	}{
		{
			name:     "xclip",
			readCmd:  []string{"xclip", "-selection", "clipboard", "-o"},
			writeCmd: []string{"xclip", "-selection", "clipboard"},
			readImg:  []string{"xclip", "-selection", "clipboard", "-t", "image/png", "-o"},
			writeImg: []string{"xclip", "-selection", "clipboard", "-t", "image/png"},
		},
		{
			name:     "xsel",
			readCmd:  []string{"xsel", "--clipboard", "--output"},
			writeCmd: []string{"xsel", "--clipboard", "--input"},
			readImg:  []string{"xsel", "--clipboard", "--output"},
			writeImg: []string{"xsel", "--clipboard", "--input"},
		},
		{
			name:     "wl-copy",
			readCmd:  []string{"wl-paste", "-n"},
			writeCmd: []string{"wl-copy"},
			readImg:  []string{"wl-paste", "-t", "image/png", "-n"},
			writeImg: []string{"wl-copy", "-t", "image/png"},
		},
	}

	selectedTool   int = -1
	toolMutex      sync.Mutex
	lastChangeTime time.Time
	changeTimeMu   sync.Mutex
)

func initialize() error {
	toolMutex.Lock()
	defer toolMutex.Unlock()

	if selectedTool >= 0 {
		return nil // Already initialized
	}

	order := []string{"xclip", "xsel", "wl-copy"}
	if os.Getenv("WAYLAND_DISPLAY") != "" {
		order = []string{"wl-copy", "xclip", "xsel"}
	}

	for _, name := range order {
		for i, tool := range clipboardTools {
			if tool.name == name {
				cmd := exec.Command("which", tool.name)
				if err := cmd.Run(); err == nil {
					clipboardTools[i].available = true
					if selectedTool < 0 {
						selectedTool = i
						slog.Debug("Clipboard tool found", "tool", tool.name)
					}
				}
				break
			}
		}
	}

	if selectedTool < 0 {
		slog.Warn(
			"No clipboard utility found on system. Copy/paste functionality will be disabled. See https://opencode.ai/docs/troubleshooting/ for more information.",
		)
		return fmt.Errorf(`%w: No clipboard utility found. Install one of the following:

For X11 systems:
	apt install -y xclip
	# or
	apt install -y xsel

For Wayland systems:
	apt install -y wl-clipboard

If running in a headless environment, you may also need:
	apt install -y xvfb
	# and run:
	Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
	export DISPLAY=:99.0`, errUnavailable)
	}

	return nil
}

func read(t Format) (buf []byte, err error) {
	// Ensure clipboard is initialized before attempting to read
	if err := initialize(); err != nil {
		slog.Debug("Clipboard read failed: not initialized", "error", err)
		return nil, err
	}

	toolMutex.Lock()
	tool := clipboardTools[selectedTool]
	toolMutex.Unlock()

	switch t {
	case FmtText:
		return readText(tool)
	case FmtImage:
		return readImage(tool)
	default:
		return nil, errUnsupported
	}
}

func readText(tool struct {
	name      string
	readCmd   []string
	writeCmd  []string
	readImg   []string
	writeImg  []string
	available bool
}) ([]byte, error) {
	// First check if clipboard contains text
	cmd := exec.Command(tool.readCmd[0], tool.readCmd[1:]...)
	out, err := cmd.Output()
	if err != nil {
		// Check if it's because clipboard contains non-text data
		if tool.name == "xclip" {
			// xclip returns error when clipboard doesn't contain requested type
			checkCmd := exec.Command("xclip", "-selection", "clipboard", "-t", "TARGETS", "-o")
			targets, _ := checkCmd.Output()
			if bytes.Contains(targets, []byte("image/png")) &&
				!bytes.Contains(targets, []byte("UTF8_STRING")) {
				return nil, errUnavailable
			}
		}
		return nil, errUnavailable
	}

	return out, nil
}

func readImage(tool struct {
	name      string
	readCmd   []string
	writeCmd  []string
	readImg   []string
	writeImg  []string
	available bool
}) ([]byte, error) {
	if tool.name == "xsel" {
		// xsel doesn't support image types well, return error
		return nil, errUnavailable
	}

	cmd := exec.Command(tool.readImg[0], tool.readImg[1:]...)
	out, err := cmd.Output()
	if err != nil {
		return nil, errUnavailable
	}

	// Verify it's PNG data
	if len(out) < 8 ||
		!bytes.Equal(out[:8], []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) {
		return nil, errUnavailable
	}

	return out, nil
}

func write(t Format, buf []byte) (<-chan struct{}, error) {
	// Ensure clipboard is initialized before attempting to write
	if err := initialize(); err != nil {
		return nil, err
	}

	toolMutex.Lock()
	tool := clipboardTools[selectedTool]
	toolMutex.Unlock()

	var cmd *exec.Cmd
	switch t {
	case FmtText:
		if len(buf) == 0 {
			// Write empty string
			cmd = exec.Command(tool.writeCmd[0], tool.writeCmd[1:]...)
			cmd.Stdin = bytes.NewReader([]byte{})
		} else {
			cmd = exec.Command(tool.writeCmd[0], tool.writeCmd[1:]...)
			cmd.Stdin = bytes.NewReader(buf)
		}
	case FmtImage:
		if tool.name == "xsel" {
			// xsel doesn't support image types well
			return nil, errUnavailable
		}
		if len(buf) == 0 {
			// Clear clipboard
			cmd = exec.Command(tool.writeCmd[0], tool.writeCmd[1:]...)
			cmd.Stdin = bytes.NewReader([]byte{})
		} else {
			cmd = exec.Command(tool.writeImg[0], tool.writeImg[1:]...)
			cmd.Stdin = bytes.NewReader(buf)
		}
	default:
		return nil, errUnsupported
	}

	if err := cmd.Run(); err != nil {
		return nil, errUnavailable
	}

	// Update change time
	changeTimeMu.Lock()
	lastChangeTime = time.Now()
	currentTime := lastChangeTime
	changeTimeMu.Unlock()

	// Create change notification channel
	changed := make(chan struct{}, 1)
	go func() {
		for {
			time.Sleep(time.Second)
			changeTimeMu.Lock()
			if !lastChangeTime.Equal(currentTime) {
				changeTimeMu.Unlock()
				changed <- struct{}{}
				close(changed)
				return
			}
			changeTimeMu.Unlock()
		}
	}()

	return changed, nil
}

func watch(ctx context.Context, t Format) <-chan []byte {
	recv := make(chan []byte, 1)

	// Ensure clipboard is initialized before starting watch
	if err := initialize(); err != nil {
		close(recv)
		return recv
	}

	ti := time.NewTicker(time.Second)

	// Get initial clipboard content
	var lastContent []byte
	if b := Read(t); b != nil {
		lastContent = make([]byte, len(b))
		copy(lastContent, b)
	}

	go func() {
		defer close(recv)
		defer ti.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ti.C:
				b := Read(t)
				if b == nil {
					continue
				}

				// Check if content changed
				if !bytes.Equal(lastContent, b) {
					recv <- b
					lastContent = make([]byte, len(b))
					copy(lastContent, b)
				}
			}
		}
	}()
	return recv
}

// Helper function to check clipboard content type for xclip
func getClipboardTargets() []string {
	cmd := exec.Command("xclip", "-selection", "clipboard", "-t", "TARGETS", "-o")
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	return strings.Split(string(out), "\n")
}
