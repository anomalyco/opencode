# clipboard [![PkgGoDev](https://pkg.go.dev/badge/golang.design/x/clipboard)](https://pkg.go.dev/golang.design/x/clipboard) ![](https://changkun.de/urlstat?mode=github&repo=golang-design/clipboard) ![clipboard](https://github.com/golang-design/clipboard/workflows/clipboard/badge.svg?branch=main)

Cross platform (macOS/Linux/Windows/Android/iOS) clipboard package in Go

```go
import "golang.design/x/clipboard"
```

## Features

- Cross platform supports: **macOS, Linux (X11), Windows, iOS, and Android**
- Copy/paste UTF-8 text
- Copy/paste PNG encoded images (Desktop-only)
- Command `gclip` as a demo application
- Mobile app `gclip-gui` as a demo application

## API Usage

Package clipboard provides cross platform clipboard access and supports
macOS/Linux/Windows/Android/iOS platform. Before interacting with the
clipboard, one must call Init to assert if it is possible to use this
package:

```go
// Init returns an error if the package is not ready for use.
err := clipboard.Init()
if err != nil {
      panic(err)
}
```

The most common operations are `Read` and `Write`. To use them:

```go
// write/read text format data of the clipboard, and
// the byte buffer regarding the text are UTF8 encoded.
clipboard.Write(clipboard.FmtText, []byte("text data"))
clipboard.Read(clipboard.FmtText)

// write/read image format data of the clipboard, and
// the byte buffer regarding the image are PNG encoded.
clipboard.Write(clipboard.FmtImage, []byte("image data"))
clipboard.Read(clipboard.FmtImage)
```

Note that read/write regarding image format assumes that the bytes are
PNG encoded since it serves the alpha blending purpose that might be
used in other graphical software.

In addition, `clipboard.Write` returns a channel that can receive an
empty struct as a signal, which indicates the corresponding write call
to the clipboard is outdated, meaning the clipboard has been overwritten
by others and the previously written data is lost. For instance:

```go
changed := clipboard.Write(clipboard.FmtText, []byte("text data"))

select {
case <-changed:
      println(`"text data" is no longer available from clipboard.`)
}
```

You can ignore the returning channel if you don't need this type of
notification. Furthermore, when you need more than just knowing whether
clipboard data is changed, use the watcher API:

```go
ch := clipboard.Watch(context.TODO(), clipboard.FmtText)
for data := range ch {
      // print out clipboard data whenever it is changed
      println(string(data))
}
```

## Demos

- A command line tool `gclip` for command line clipboard accesses, see document [here](./cmd/gclip/README.md).
- A GUI application `gclip-gui` for functionality verifications on mobile systems, see a document [here](./cmd/gclip-gui/README.md).


## Command Usage

`gclip` command offers the ability to interact with the system clipboard
from the shell. To install:

```bash
$ go install golang.design/x/clipboard/cmd/gclip@latest
```

```bash
$ gclip
gclip is a command that provides clipboard interaction.

usage: gclip [-copy|-paste] [-f <file>]

options:
  -copy
        copy data to clipboard
  -f string
        source or destination to a given file path
  -paste
        paste data from clipboard

examples:
gclip -paste                    paste from clipboard and prints the content
gclip -paste -f x.txt           paste from clipboard and save as text to x.txt
gclip -paste -f x.png           paste from clipboard and save as image to x.png

cat x.txt | gclip -copy         copy content from x.txt to clipboard
gclip -copy -f x.txt            copy content from x.txt to clipboard
gclip -copy -f x.png            copy x.png as image data to clipboard
```

If `-copy` is used, the command will exit when the data is no longer
available from the clipboard. You can always send the command to the
background using a shell `&` operator, for example:

```bash
$ cat x.txt | gclip -copy &
```

## Platform Specific Details

This package spent efforts to provide cross platform abstraction regarding
accessing system clipboards, but here are a few details you might need to know.

### Dependency

- macOS: require Cgo, no dependency
 - Linux: require X11 dev package. For instance, install `libx11-dev` or `xorg-dev` or `libX11-devel` to access X window system.
   Wayland sessions are currently unsupported; running under Wayland
   typically requires an XWayland bridge and `DISPLAY` to be set.
- Windows: no Cgo, no dependency
- iOS/Android: collaborate with [`gomobile`](https://golang.org/x/mobile)

### Screenshot

In general, when you need test your implementation regarding images,
There are system level shortcuts to put screenshot image into your system clipboard:

- On macOS, use `Ctrl+Shift+Cmd+4`
- On Linux/Ubuntu, use `Ctrl+Shift+PrintScreen`
- On Windows, use `Shift+Win+s`

As described in the API documentation, the package supports read/write
UTF8 encoded plain text or PNG encoded image data. Thus,
the other types of data are not supported yet, i.e. undefined behavior.

## Who is using this package?

The main purpose of building this package is to support the
[midgard](https://changkun.de/s/midgard) project, which offers
clipboard-based features like universal clipboard service that syncs
clipboard content across multiple systems, allocating public accessible
for clipboard content, etc.

To know more projects, check our [wiki](https://github.com/golang-design/clipboard/wiki) page.

## License

MIT | &copy; 2021 The golang.design Initiative Authors, written by [Changkun Ou](https://changkun.de).