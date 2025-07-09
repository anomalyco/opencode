// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build cgo

package clipboard_test

import (
	"context"
	"fmt"
	"time"

	"golang.design/x/clipboard"
)

func ExampleWrite() {
	err := clipboard.Init()
	if err != nil {
		panic(err)
	}

	clipboard.Write(clipboard.FmtText, []byte("Hello, 世界"))
	// Output:
}

func ExampleRead() {
	err := clipboard.Init()
	if err != nil {
		panic(err)
	}

	fmt.Println(string(clipboard.Read(clipboard.FmtText)))
	// Output:
	// Hello, 世界
}

func ExampleWatch() {
	err := clipboard.Init()
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second*2)
	defer cancel()

	changed := clipboard.Watch(context.Background(), clipboard.FmtText)
	go func(ctx context.Context) {
		clipboard.Write(clipboard.FmtText, []byte("你好，world"))
	}(ctx)
	fmt.Println(string(<-changed))
	// Output:
	// 你好，world
}
