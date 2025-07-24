// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build darwin

package clipboard

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	lastChangeCount int64
	changeCountMu   sync.Mutex
)

func initialize() error { return nil }

func read(t Format) (buf []byte, err error) {
	switch t {
	case FmtText:
		return readText()
	case FmtImage:
		return readImage()
	default:
		return nil, errUnsupported
	}
}

func readText() ([]byte, error) {
	// Check if clipboard contains string data
	checkScript := `
	try
		set clipboardTypes to (clipboard info)
		repeat with aType in clipboardTypes
			if (first item of aType) is string then
				return "hastext"
			end if
		end repeat
		return "notext"
	on error
		return "error"
	end try
	`

	cmd := exec.Command("osascript", "-e", checkScript)
	checkOut, err := cmd.Output()
	if err != nil {
		return nil, errUnavailable
	}

	checkOut = bytes.TrimSpace(checkOut)
	if !bytes.Equal(checkOut, []byte("hastext")) {
		return nil, errUnavailable
	}

	// Now get the actual text
	cmd = exec.Command("osascript", "-e", "get the clipboard")
	out, err := cmd.Output()
	if err != nil {
		return nil, errUnavailable
	}
	// Remove trailing newline that osascript adds
	out = bytes.TrimSuffix(out, []byte("\n"))

	// If clipboard was set to empty string, return nil
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}
func readImage() ([]byte, error) {
	// AppleScript to read image data from clipboard as base64
	script := `
	try
		set theData to the clipboard as «class PNGf»
		return theData
	on error
		return ""
	end try
	`

	cmd := exec.Command("osascript", "-e", script)
	out, err := cmd.Output()
	if err != nil {
		return nil, errUnavailable
	}

	// Check if we got any data
	out = bytes.TrimSpace(out)
	if len(out) == 0 {
		return nil, errUnavailable
	}

	// The output is in hex format (e.g., «data PNGf89504E...»)
	// We need to extract and convert it
	outStr := string(out)
	if !strings.HasPrefix(outStr, "«data PNGf") || !strings.HasSuffix(outStr, "»") {
		return nil, errUnavailable
	}

	// Extract hex data
	hexData := strings.TrimPrefix(outStr, "«data PNGf")
	hexData = strings.TrimSuffix(hexData, "»")

	// Convert hex to bytes
	buf := make([]byte, len(hexData)/2)
	for i := 0; i < len(hexData); i += 2 {
		b, err := strconv.ParseUint(hexData[i:i+2], 16, 8)
		if err != nil {
			return nil, errUnavailable
		}
		buf[i/2] = byte(b)
	}

	return buf, nil
}

// write writes the given data to clipboard and
// returns true if success or false if failed.
func write(t Format, buf []byte) (<-chan struct{}, error) {
	var err error
	switch t {
	case FmtText:
		err = writeText(buf)
	case FmtImage:
		err = writeImage(buf)
	default:
		return nil, errUnsupported
	}

	if err != nil {
		return nil, err
	}

	// Update change count
	changeCountMu.Lock()
	lastChangeCount++
	currentCount := lastChangeCount
	changeCountMu.Unlock()

	// use unbuffered channel to prevent goroutine leak
	changed := make(chan struct{}, 1)
	go func() {
		for {
			time.Sleep(time.Second)
			changeCountMu.Lock()
			if lastChangeCount != currentCount {
				changeCountMu.Unlock()
				changed <- struct{}{}
				close(changed)
				return
			}
			changeCountMu.Unlock()
		}
	}()
	return changed, nil
}

func writeText(buf []byte) error {
	if len(buf) == 0 {
		// Clear clipboard
		script := `set the clipboard to ""`
		cmd := exec.Command("osascript", "-e", script)
		if err := cmd.Run(); err != nil {
			return errUnavailable
		}
		return nil
	}

	// Escape the text for AppleScript
	text := string(buf)
	text = strings.ReplaceAll(text, "\\", "\\\\")
	text = strings.ReplaceAll(text, "\"", "\\\"")

	script := fmt.Sprintf(`set the clipboard to "%s"`, text)
	cmd := exec.Command("osascript", "-e", script)
	if err := cmd.Run(); err != nil {
		return errUnavailable
	}
	return nil
}
func writeImage(buf []byte) error {
	if len(buf) == 0 {
		// Clear clipboard
		script := `set the clipboard to ""`
		cmd := exec.Command("osascript", "-e", script)
		if err := cmd.Run(); err != nil {
			return errUnavailable
		}
		return nil
	}

	// Create a temporary file to store the PNG data
	tmpFile, err := os.CreateTemp("", "clipboard*.png")
	if err != nil {
		return errUnavailable
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(buf); err != nil {
		tmpFile.Close()
		return errUnavailable
	}
	tmpFile.Close()

	// Use osascript to set clipboard to the image file
	script := fmt.Sprintf(`
	set theFile to POSIX file "%s"
	set theImage to read theFile as «class PNGf»
	set the clipboard to theImage
	`, tmpFile.Name())

	cmd := exec.Command("osascript", "-e", script)
	if err := cmd.Run(); err != nil {
		return errUnavailable
	}
	return nil
}
func watch(ctx context.Context, t Format) <-chan []byte {
	recv := make(chan []byte, 1)
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
