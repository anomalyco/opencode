// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

package main // go install golang.design/x/clipboard/cmd/gclip@latest

import (
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"golang.design/x/clipboard"
)

func usage() {
	fmt.Fprintf(os.Stderr, `gclip is a command that provides clipboard interaction.

usage: gclip [-copy|-paste] [-f <file>]

options:
`)
	flag.PrintDefaults()
	fmt.Fprintf(os.Stderr, `
examples:
gclip -paste                    paste from clipboard and prints the content
gclip -paste -f x.txt           paste from clipboard and save as text to x.txt
gclip -paste -f x.png           paste from clipboard and save as image to x.png

cat x.txt | gclip -copy         copy content from x.txt to clipboard
gclip -copy -f x.txt            copy content from x.txt to clipboard
gclip -copy -f x.png            copy x.png as image data to clipboard
`)
	os.Exit(2)
}

var (
	in   = flag.Bool("copy", false, "copy data to clipboard")
	out  = flag.Bool("paste", false, "paste data from clipboard")
	file = flag.String("f", "", "source or destination to a given file path")
)

func init() {
	err := clipboard.Init()
	if err != nil {
		panic(err)
	}
}

func main() {
	flag.Usage = usage
	flag.Parse()
	if *out {
		if err := pst(); err != nil {
			usage()
		}
		return
	}
	if *in {
		if err := cpy(); err != nil {
			usage()
		}
		return
	}
	usage()
}

func cpy() error {
	t := clipboard.FmtText
	ext := filepath.Ext(*file)

	switch ext {
	case ".png":
		t = clipboard.FmtImage
	case ".txt":
		fallthrough
	default:
		t = clipboard.FmtText
	}

	var (
		b   []byte
		err error
	)
	if *file != "" {
		b, err = os.ReadFile(*file)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read given file: %v", err)
			return err
		}
	} else {
		b, err = io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to read from stdin: %v", err)
			return err
		}
	}

	// Wait until clipboard content has been changed.
	<-clipboard.Write(t, b)
	return nil
}

func pst() (err error) {
	var b []byte

	b = clipboard.Read(clipboard.FmtText)
	if b == nil {
		b = clipboard.Read(clipboard.FmtImage)
	}

	if *file != "" && b != nil {
		err = os.WriteFile(*file, b, os.ModePerm)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to write data to file %s: %v", *file, err)
		}
		return err
	}

	for len(b) > 0 {
		n, err := os.Stdout.Write(b)
		if err != nil {
			return err
		}
		b = b[n:]
	}
	return nil
}
