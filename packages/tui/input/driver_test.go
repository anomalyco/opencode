package input

import (
	"io"
	"strings"
	"testing"
)

func BenchmarkDriver(b *testing.B) {
	input := "\x1b\x1b[Ztest\x00\x1b]10;1234/1234/1234\x07\x1b[27;2;27~"
	rdr := strings.NewReader(input)
	drv, err := NewReader(rdr, "dumb", 0)
	if err != nil {
		b.Fatalf("could not create driver: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rdr.Reset(input)
		if _, err := drv.ReadEvents(); err != nil && err != io.EOF {
			b.Errorf("error reading input: %v", err)
		}
	}
}
