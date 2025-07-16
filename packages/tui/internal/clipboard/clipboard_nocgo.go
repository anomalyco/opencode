//go:build !windows && !darwin && !linux && !cgo

package clipboard

import "context"

func initialize() error {
	return errNoCgo
}

func read(t Format) (buf []byte, err error) {
	panic("clipboard: cannot use when CGO_ENABLED=0")
}

func readc(t string) ([]byte, error) {
	panic("clipboard: cannot use when CGO_ENABLED=0")
}

func write(t Format, buf []byte) (<-chan struct{}, error) {
	panic("clipboard: cannot use when CGO_ENABLED=0")
}

func watch(ctx context.Context, t Format) <-chan []byte {
	panic("clipboard: cannot use when CGO_ENABLED=0")
}
