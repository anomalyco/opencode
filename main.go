package main

import (
    "fmt"
)

var Version = "0.6.12"

func main() {
    fmt.Println("lash", Version)
    fmt.Println("For the full CLI with TUI, install via Homebrew or npm:")
    fmt.Println("  brew install lacymorrow/tap/lash")
    fmt.Println("  npm i -g lash-cli")
}


