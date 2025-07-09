# gclip

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

## License

MIT | &copy; 2021 The golang.design Initiative Authors, written by [Changkun Ou](https://changkun.de).