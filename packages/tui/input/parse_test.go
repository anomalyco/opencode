package input

import (
	"image/color"
	"reflect"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestParseSequence_Events(t *testing.T) {
	input := []byte("\x1b\x1b[Ztest\x00\x1b]10;rgb:1234/1234/1234\x07\x1b[27;2;27~\x1b[?1049;2$y\x1b[4;1$y")
	want := []Event{
		KeyPressEvent{Code: KeyTab, Mod: ModShift | ModAlt},
		KeyPressEvent{Code: 't', Text: "t"},
		KeyPressEvent{Code: 'e', Text: "e"},
		KeyPressEvent{Code: 's', Text: "s"},
		KeyPressEvent{Code: 't', Text: "t"},
		KeyPressEvent{Code: KeySpace, Mod: ModCtrl},
		ForegroundColorEvent{color.RGBA{R: 0x12, G: 0x12, B: 0x12, A: 0xff}},
		KeyPressEvent{Code: KeyEscape, Mod: ModShift},
		ModeReportEvent{Mode: ansi.AltScreenSaveCursorMode, Value: ansi.ModeReset},
		ModeReportEvent{Mode: ansi.InsertReplaceMode, Value: ansi.ModeSet},
	}

	var p Parser
	for i := 0; len(input) != 0; i++ {
		if i >= len(want) {
			t.Fatalf("reached end of want events")
		}
		n, got := p.parseSequence(input)
		if !reflect.DeepEqual(got, want[i]) {
			t.Errorf("got %#v (%T), want %#v (%T)", got, got, want[i], want[i])
		}
		input = input[n:]
	}
}

func BenchmarkParseSequence(b *testing.B) {
	var p Parser
	input := []byte("\x1b\x1b[Ztest\x00\x1b]10;1234/1234/1234\x07\x1b[27;2;27~")
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		p.parseSequence(input)
	}
}
