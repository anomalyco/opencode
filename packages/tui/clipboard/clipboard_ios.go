// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build ios

package clipboard

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation -framework UIKit -framework MobileCoreServices

#import <stdlib.h>
void clipboard_write_string(char *s);
char *clipboard_read_string();
*/
import "C"
import (
	"bytes"
	"context"
	"time"
	"unsafe"
)

func initialize() error { return nil }

func read(t Format) (buf []byte, err error) {
	switch t {
	case FmtText:
		return []byte(C.GoString(C.clipboard_read_string())), nil
	case FmtImage:
		return nil, errUnsupported
	default:
		return nil, errUnsupported
	}
}

// SetContent sets the clipboard content for iOS
func write(t Format, buf []byte) (<-chan struct{}, error) {
	done := make(chan struct{}, 1)
	switch t {
	case FmtText:
		cs := C.CString(string(buf))
		defer C.free(unsafe.Pointer(cs))

		C.clipboard_write_string(cs)
		return done, nil
	case FmtImage:
		return nil, errUnsupported
	default:
		return nil, errUnsupported
	}
}

func watch(ctx context.Context, t Format) <-chan []byte {
	recv := make(chan []byte, 1)
	ti := time.NewTicker(time.Second)
	last := Read(t)
	go func() {
		for {
			select {
			case <-ctx.Done():
				close(recv)
				return
			case <-ti.C:
				b := Read(t)
				if b == nil {
					continue
				}
				if bytes.Compare(last, b) != 0 {
					recv <- b
					last = b
				}
			}
		}
	}()
	return recv
}
