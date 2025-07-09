// Copyright 2021 The golang.design Initiative Authors.
// All rights reserved. Use of this source code is governed
// by a MIT license that can be found in the LICENSE file.
//
// Written by Changkun Ou <changkun.de>

//go:build android || ios || linux || darwin || windows

// This is a very basic example for verification purpose that
// demonstrates how the golang.design/x/clipboard can interact
// with macOS/Linux/Windows/Android/iOS system clipboard.
//
// The gclip GUI application writes a string to the system clipboard
// periodically then reads it back and renders it if possible.
//
// Because of the system limitation, on mobile devices, only string
// data is supported at the moment. Hence, one must use clipboard.FmtText.
// Other supplied formats result in a panic.
//
// This example is intentded as cross platform application.
// To build it, one must use gomobile (https://golang.org/x/mobile).
// You may follow the instructions provided in the GoMobile's wiki page:
// https://github.com/golang/go/wiki/Mobile.
//
// - For desktop:
//
// 	go build -o gclip-gui
//
// - For Android:
//
// 	gomobile build -v -target=android -o gclip-gui.apk
//
// - For iOS:
//
// 	gomobile build -v -target=ios -bundleid design.golang.gclip-gui.app
//
package main

import (
	"fmt"
	"image"
	"image/color"
	"log"
	"os"
	"sync"
	"time"

	"golang.design/x/clipboard"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	"golang.org/x/mobile/app"
	"golang.org/x/mobile/event/lifecycle"
	"golang.org/x/mobile/event/paint"
	"golang.org/x/mobile/event/size"
	"golang.org/x/mobile/exp/gl/glutil"
	"golang.org/x/mobile/geom"
	"golang.org/x/mobile/gl"
)

type Label struct {
	sz     size.Event
	images *glutil.Images
	m      *glutil.Image
	drawer *font.Drawer

	mu   sync.Mutex
	data string
}

func NewLabel(images *glutil.Images) *Label {
	return &Label{
		images: images,
		data:   "Hello! Gclip.",
		drawer: nil,
	}
}

func (l *Label) SetLabel(s string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.data = s
}

const (
	lineWidth  = 100
	lineHeight = 120
)

func (l *Label) Draw(sz size.Event) {
	l.mu.Lock()
	s := l.data
	l.mu.Unlock()
	imgW, imgH := lineWidth*basicfont.Face7x13.Width, lineHeight*basicfont.Face7x13.Height
	if sz.WidthPx == 0 && sz.HeightPx == 0 {
		return
	}
	if imgW > sz.WidthPx {
		imgW = sz.WidthPx
	}

	if l.sz != sz {
		l.sz = sz
		if l.m != nil {
			l.m.Release()
		}
		l.m = l.images.NewImage(imgW, imgH)
	}
	// Clear the drawing image.
	for i := 0; i < len(l.m.RGBA.Pix); i++ {
		l.m.RGBA.Pix[i] = 0
	}

	l.drawer = &font.Drawer{
		Dst:  l.m.RGBA,
		Src:  image.NewUniform(color.RGBA{0, 100, 125, 255}),
		Face: basicfont.Face7x13,
		Dot:  fixed.P(5, 10),
	}
	l.drawer.DrawString(s)
	l.m.Upload()
	l.m.Draw(
		sz,
		geom.Point{X: 0, Y: 50},
		geom.Point{X: geom.Pt(imgW), Y: 50},
		geom.Point{X: 0, Y: geom.Pt(imgH)},
		l.m.RGBA.Bounds(),
	)
}

func (l *Label) Release() {
	if l.m != nil {
		l.m.Release()
		l.m = nil
		l.images = nil
	}
}

// GclipApp is the application instance.
type GclipApp struct {
	app app.App

	ctx gl.Context
	siz size.Event

	images *glutil.Images
	l      *Label

	counter int
}

// WatchClipboard watches the system clipboard every seconds.
func (g *GclipApp) WatchClipboard() {
	go func() {
		tk := time.NewTicker(time.Second)
		for range tk.C {
			// Write something to the clipboard
			w := fmt.Sprintf("(gclip: %d)", g.counter)
			clipboard.Write(clipboard.FmtText, []byte(w))
			g.counter++
			log.Println(w)

			// Read it back and render it, if possible.
			data := clipboard.Read(clipboard.FmtText)
			if len(data) == 0 {
				continue
			}

			// Set the current clipboard data as label content and render on the screen.
			r := fmt.Sprintf("clipboard: %s", string(data))
			g.l.SetLabel(r)
			g.app.Send(paint.Event{})
		}
	}()
}

func (g *GclipApp) OnStart(e lifecycle.Event) {
	g.ctx, _ = e.DrawContext.(gl.Context)
	g.images = glutil.NewImages(g.ctx)
	g.l = NewLabel(g.images)
	g.app.Send(paint.Event{})
}

func (g *GclipApp) OnStop() {
	g.l.Release()
	g.images.Release()
	g.ctx = nil
}

func (g *GclipApp) OnSize(size size.Event) {
	g.siz = size
}

func (g *GclipApp) OnDraw() {
	if g.ctx == nil {
		return
	}
	defer g.app.Send(paint.Event{})
	defer g.app.Publish()
	g.ctx.ClearColor(0, 0, 0, 1)
	g.ctx.Clear(gl.COLOR_BUFFER_BIT)
	g.l.Draw(g.siz)
}

func init() {
	err := clipboard.Init()
	if err != nil {
		panic(err)
	}
}

func main() {
	app.Main(func(a app.App) {
		gclip := GclipApp{app: a}
		gclip.app.Send(size.Event{WidthPx: 800, HeightPx: 500})
		gclip.WatchClipboard()
		for e := range gclip.app.Events() {
			switch e := gclip.app.Filter(e).(type) {
			case lifecycle.Event:
				switch e.Crosses(lifecycle.StageVisible) {
				case lifecycle.CrossOn:
					gclip.OnStart(e)
				case lifecycle.CrossOff:
					gclip.OnStop()
					os.Exit(0)
				}
			case size.Event:
				gclip.OnSize(e)
			case paint.Event:
				gclip.OnDraw()
			}
		}
	})
}
