// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build android

package clipboard

/*
#cgo LDFLAGS: -landroid -llog

#include <stdlib.h>
char *clipboard_read_string(uintptr_t java_vm, uintptr_t jni_env, uintptr_t ctx);
void clipboard_write_string(uintptr_t java_vm, uintptr_t jni_env, uintptr_t ctx, char *str);

*/
import "C"
import (
	"bytes"
	"context"
	"time"
	"unsafe"

	"golang.org/x/mobile/app"
)

func initialize() error { return nil }

func read(t Format) (buf []byte, err error) {
	switch t {
	case FmtText:
		s := ""
		if err := app.RunOnJVM(func(vm, env, ctx uintptr) error {
			cs := C.clipboard_read_string(C.uintptr_t(vm), C.uintptr_t(env), C.uintptr_t(ctx))
			if cs == nil {
				return nil
			}

			s = C.GoString(cs)
			C.free(unsafe.Pointer(cs))
			return nil
		}); err != nil {
			return nil, err
		}
		return []byte(s), nil
	case FmtImage:
		return nil, errUnsupported
	default:
		return nil, errUnsupported
	}
}

// write writes the given data to clipboard and
// returns true if success or false if failed.
func write(t Format, buf []byte) (<-chan struct{}, error) {
	done := make(chan struct{}, 1)
	switch t {
	case FmtText:
		cs := C.CString(string(buf))
		defer C.free(unsafe.Pointer(cs))

		if err := app.RunOnJVM(func(vm, env, ctx uintptr) error {
			C.clipboard_write_string(C.uintptr_t(vm), C.uintptr_t(env), C.uintptr_t(ctx), cs)
			done <- struct{}{}
			return nil
		}); err != nil {
			return nil, err
		}
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
