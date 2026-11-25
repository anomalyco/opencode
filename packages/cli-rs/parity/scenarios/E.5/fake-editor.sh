#!/bin/sh
# A stand-in for $EDITOR in E.5/editor.pty.ts: it edits the file it is given as an editor would on save, and
# notes whether it got the terminal. No real editor runs.
if [ -t 0 ] && [ -t 1 ]; then terminal=tty; else terminal=notty; fi
{
  printf 'edited: '
  cat "$1"
  printf ' (%s)\nsecond line\n' "$terminal"
} > "$1.tmp"
mv "$1.tmp" "$1"
