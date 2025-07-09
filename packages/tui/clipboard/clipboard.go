// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

/*
Package clipboard provides cross platform clipboard access and supports
macOS/Linux/Windows/Android/iOS platform. Before interacting with the
clipboard, one must call Init to assert if it is possible to use this
package:

	err := clipboard.Init()
	if err != nil {
		panic(err)
	}

The most common operations are `Read` and `Write`. To use them:

	// write/read text format data of the clipboard, and
	// the byte buffer regarding the text are UTF8 encoded.
	clipboard.Write(clipboard.FmtText, []byte("text data"))
	clipboard.Read(clipboard.FmtText)

	// write/read image format data of the clipboard, and
	// the byte buffer regarding the image are PNG encoded.
	clipboard.Write(clipboard.FmtImage, []byte("image data"))
	clipboard.Read(clipboard.FmtImage)

Note that read/write regarding image format assumes that the bytes are
PNG encoded since it serves the alpha blending purpose that might be
used in other graphical software.

In addition, `clipboard.Write` returns a channel that can receive an
empty struct as a signal, which indicates the corresponding write call
to the clipboard is outdated, meaning the clipboard has been overwritten
by others and the previously written data is lost. For instance:

	changed := clipboard.Write(clipboard.FmtText, []byte("text data"))

	select {
	case <-changed:
		println(`"text data" is no longer available from clipboard.`)
	}

You can ignore the returning channel if you don't need this type of
notification. Furthermore, when you need more than just knowing whether
clipboard data is changed, use the watcher API:

	ch := clipboard.Watch(context.TODO(), clipboard.FmtText)
	for data := range ch {
		// print out clipboard data whenever it is changed
		println(string(data))
	}
*/
package clipboard // import "golang.design/x/clipboard"

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
)

var (
	// activate only for running tests.
	debug          = false
	errUnavailable = errors.New("clipboard unavailable")
	errUnsupported = errors.New("unsupported format")
	errNoCgo       = errors.New("clipboard: cannot use when CGO_ENABLED=0")
)

// Format represents the format of clipboard data.
type Format int

// All sorts of supported clipboard data
const (
	// FmtText indicates plain text clipboard format
	FmtText Format = iota
	// FmtImage indicates image/png clipboard format
	FmtImage
)

var (
	// Due to the limitation on operating systems (such as darwin),
	// concurrent read can even cause panic, use a global lock to
	// guarantee one read at a time.
	lock      = sync.Mutex{}
	initOnce  sync.Once
	initError error
)

// Init initializes the clipboard package. It returns an error
// if the clipboard is not available to use. This may happen if the
// target system lacks required dependency, such as libx11-dev in X11
// environment. For example,
//
//	err := clipboard.Init()
//	if err != nil {
//		panic(err)
//	}
//
// If Init returns an error, any subsequent Read/Write/Watch call
// may result in an unrecoverable panic.
func Init() error {
	initOnce.Do(func() {
		initError = initialize()
	})
	return initError
}

// Read returns a chunk of bytes of the clipboard data if it presents
// in the desired format t presents. Otherwise, it returns nil.
func Read(t Format) []byte {
	lock.Lock()
	defer lock.Unlock()

	buf, err := read(t)
	if err != nil {
		if debug {
			fmt.Fprintf(os.Stderr, "read clipboard err: %v\n", err)
		}
		return nil
	}
	return buf
}

// Write writes a given buffer to the clipboard in a specified format.
// Write returned a receive-only channel can receive an empty struct
// as a signal, which indicates the clipboard has been overwritten from
// this write.
// If format t indicates an image, then the given buf assumes
// the image data is PNG encoded.
func Write(t Format, buf []byte) <-chan struct{} {
	lock.Lock()
	defer lock.Unlock()

	changed, err := write(t, buf)
	if err != nil {
		if debug {
			fmt.Fprintf(os.Stderr, "write to clipboard err: %v\n", err)
		}
		return nil
	}
	return changed
}

// Watch returns a receive-only channel that received the clipboard data
// whenever any change of clipboard data in the desired format happens.
//
// The returned channel will be closed if the given context is canceled.
func Watch(ctx context.Context, t Format) <-chan []byte {
	return watch(ctx, t)
}
