package input

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"image/color"
	"io"
	"math/rand"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/charmbracelet/x/ansi/kitty"
)

var sequences = buildKeysTable(FlagTerminfo, "dumb")

func TestKeyString(t *testing.T) {
	t.Run("alt+space", func(t *testing.T) {
		k := KeyPressEvent{Code: KeySpace, Mod: ModAlt}
		if got := k.String(); got != "alt+space" {
			t.Fatalf(`expected a "alt+space", got %q`, got)
		}
	})

	t.Run("runes", func(t *testing.T) {
		k := KeyPressEvent{Code: 'a', Text: "a"}
		if got := k.String(); got != "a" {
			t.Fatalf(`expected an "a", got %q`, got)
		}
	})

	t.Run("invalid", func(t *testing.T) {
		k := KeyPressEvent{Code: 99999}
		if got := k.String(); got != "𘚟" {
			t.Fatalf(`expected a "unknown", got %q`, got)
		}
	})

	t.Run("space", func(t *testing.T) {
		k := KeyPressEvent{Code: KeySpace, Text: " "}
		if got := k.String(); got != "space" {
			t.Fatalf(`expected a "space", got %q`, got)
		}
	})

	t.Run("shift+space", func(t *testing.T) {
		k := KeyPressEvent{Code: KeySpace, Mod: ModShift}
		if got := k.String(); got != "shift+space" {
			t.Fatalf(`expected a "shift+space", got %q`, got)
		}
	})

	t.Run("?", func(t *testing.T) {
		k := KeyPressEvent{Code: '/', Mod: ModShift, Text: "?"}
		if got := k.String(); got != "?" {
			t.Fatalf(`expected a "?", got %q`, got)
		}
	})
}

type seqTest struct {
	seq    []byte
	Events []Event
}

var f3CurPosRegexp = regexp.MustCompile(`\x1b\[1;(\d+)R`)

// buildBaseSeqTests returns sequence tests that are valid for the
// detectSequence() function.
func buildBaseSeqTests() []seqTest {
	td := []seqTest{}
	for seq, key := range sequences {
		k := KeyPressEvent(key)
		st := seqTest{seq: []byte(seq), Events: []Event{k}}

		// XXX: This is a special case to handle F3 key sequence and cursor
		// position report having the same sequence. See [parseCsi] for more
		// information.
		if f3CurPosRegexp.MatchString(seq) {
			st.Events = []Event{k, CursorPositionEvent{Y: 0, X: int(key.Mod)}}
		}
		td = append(td, st)
	}

	// Additional special cases.
	td = append(td,
		// Unrecognized CSI sequence.
		seqTest{
			[]byte{'\x1b', '[', '-', '-', '-', '-', 'X'},
			[]Event{
				UnknownEvent([]byte{'\x1b', '[', '-', '-', '-', '-', 'X'}),
			},
		},
		// A lone space character.
		seqTest{
			[]byte{' '},
			[]Event{
				KeyPressEvent{Code: KeySpace, Text: " "},
			},
		},
		// An escape character with the alt modifier.
		seqTest{
			[]byte{'\x1b', ' '},
			[]Event{
				KeyPressEvent{Code: KeySpace, Mod: ModAlt},
			},
		},
	)
	return td
}

func TestParseSequence(t *testing.T) {
	td := buildBaseSeqTests()
	td = append(td,
		// Background color.
		seqTest{
			[]byte("\x1b]11;rgb:1234/1234/1234\x07"),
			[]Event{BackgroundColorEvent{
				Color: color.RGBA{R: 0x12, G: 0x12, B: 0x12, A: 0xff},
			}},
		},
		seqTest{
			[]byte("\x1b]11;rgb:1234/1234/1234\x1b\\"),
			[]Event{BackgroundColorEvent{
				Color: color.RGBA{R: 0x12, G: 0x12, B: 0x12, A: 0xff},
			}},
		},
		seqTest{
			[]byte("\x1b]11;rgb:1234/1234/1234\x1b"), // Incomplete sequences are ignored.
			[]Event{
				UnknownEvent("\x1b]11;rgb:1234/1234/1234\x1b"),
			},
		},

		// Kitty Graphics response.
		seqTest{
			[]byte("\x1b_Ga=t;OK\x1b\\"),
			[]Event{KittyGraphicsEvent{
				Options: kitty.Options{Action: kitty.Transmit},
				Payload: []byte("OK"),
			}},
		},
		seqTest{
			[]byte("\x1b_Gi=99,I=13;OK\x1b\\"),
			[]Event{KittyGraphicsEvent{
				Options: kitty.Options{ID: 99, Number: 13},
				Payload: []byte("OK"),
			}},
		},
		seqTest{
			[]byte("\x1b_Gi=1337,q=1;EINVAL:your face\x1b\\"),
			[]Event{KittyGraphicsEvent{
				Options: kitty.Options{ID: 1337, Quite: 1},
				Payload: []byte("EINVAL:your face"),
			}},
		},

		// Xterm modifyOtherKeys CSI 27 ; <modifier> ; <code> ~
		seqTest{
			[]byte("\x1b[27;3;20320~"),
			[]Event{KeyPressEvent{Code: '你', Mod: ModAlt}},
		},
		seqTest{
			[]byte("\x1b[27;3;65~"),
			[]Event{KeyPressEvent{Code: 'A', Mod: ModAlt}},
		},
		seqTest{
			[]byte("\x1b[27;3;8~"),
			[]Event{KeyPressEvent{Code: KeyBackspace, Mod: ModAlt}},
		},
		seqTest{
			[]byte("\x1b[27;3;27~"),
			[]Event{KeyPressEvent{Code: KeyEscape, Mod: ModAlt}},
		},
		seqTest{
			[]byte("\x1b[27;3;127~"),
			[]Event{KeyPressEvent{Code: KeyBackspace, Mod: ModAlt}},
		},

		// Xterm report window text area size.
		seqTest{
			[]byte("\x1b[4;24;80t"),
			[]Event{
				WindowOpEvent{Op: 4, Args: []int{24, 80}},
			},
		},

		// Kitty keyboard / CSI u (fixterms)
		seqTest{
			[]byte("\x1b[1B"),
			[]Event{KeyPressEvent{Code: KeyDown}},
		},
		seqTest{
			[]byte("\x1b[1;B"),
			[]Event{KeyPressEvent{Code: KeyDown}},
		},
		seqTest{
			[]byte("\x1b[1;4B"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyDown}},
		},
		seqTest{
			[]byte("\x1b[1;4:1B"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyDown}},
		},
		seqTest{
			[]byte("\x1b[1;4:2B"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyDown, IsRepeat: true}},
		},
		seqTest{
			[]byte("\x1b[1;4:3B"),
			[]Event{KeyReleaseEvent{Mod: ModShift | ModAlt, Code: KeyDown}},
		},
		seqTest{
			[]byte("\x1b[8~"),
			[]Event{KeyPressEvent{Code: KeyEnd}},
		},
		seqTest{
			[]byte("\x1b[8;~"),
			[]Event{KeyPressEvent{Code: KeyEnd}},
		},
		seqTest{
			[]byte("\x1b[8;10~"),
			[]Event{KeyPressEvent{Mod: ModShift | ModMeta, Code: KeyEnd}},
		},
		seqTest{
			[]byte("\x1b[27;4u"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyEscape}},
		},
		seqTest{
			[]byte("\x1b[127;4u"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyBackspace}},
		},
		seqTest{
			[]byte("\x1b[57358;4u"),
			[]Event{KeyPressEvent{Mod: ModShift | ModAlt, Code: KeyCapsLock}},
		},
		seqTest{
			[]byte("\x1b[9;2u"),
			[]Event{KeyPressEvent{Mod: ModShift, Code: KeyTab}},
		},
		seqTest{
			[]byte("\x1b[195;u"),
			[]Event{KeyPressEvent{Text: "Ã", Code: 'Ã'}},
		},
		seqTest{
			[]byte("\x1b[20320;2u"),
			[]Event{KeyPressEvent{Text: "你", Mod: ModShift, Code: '你'}},
		},
		seqTest{
			[]byte("\x1b[195;:1u"),
			[]Event{KeyPressEvent{Text: "Ã", Code: 'Ã'}},
		},
		seqTest{
			[]byte("\x1b[195;2:3u"),
			[]Event{KeyReleaseEvent{Code: 'Ã', Text: "Ã", Mod: ModShift}},
		},
		seqTest{
			[]byte("\x1b[195;2:2u"),
			[]Event{KeyPressEvent{Code: 'Ã', Text: "Ã", IsRepeat: true, Mod: ModShift}},
		},
		seqTest{
			[]byte("\x1b[195;2:1u"),
			[]Event{KeyPressEvent{Code: 'Ã', Text: "Ã", Mod: ModShift}},
		},
		seqTest{
			[]byte("\x1b[195;2:3u"),
			[]Event{KeyReleaseEvent{Code: 'Ã', Text: "Ã", Mod: ModShift}},
		},
		seqTest{
			[]byte("\x1b[97;2;65u"),
			[]Event{KeyPressEvent{Code: 'a', Text: "A", Mod: ModShift}},
		},
		seqTest{
			[]byte("\x1b[97;;229u"),
			[]Event{KeyPressEvent{Code: 'a', Text: "å"}},
		},

		// focus/blur
		seqTest{
			[]byte{'\x1b', '[', 'I'},
			[]Event{
				FocusEvent{},
			},
		},
		seqTest{
			[]byte{'\x1b', '[', 'O'},
			[]Event{
				BlurEvent{},
			},
		},
		// Mouse event.
		seqTest{
			[]byte{'\x1b', '[', 'M', byte(32) + 0b0100_0000, byte(65), byte(49)},
			[]Event{
				MouseWheelEvent{X: 32, Y: 16, Button: MouseWheelUp},
			},
		},
		// SGR Mouse event.
		seqTest{
			[]byte("\x1b[<0;33;17M"),
			[]Event{
				MouseClickEvent{X: 32, Y: 16, Button: MouseLeft},
			},
		},
		// Runes.
		seqTest{
			[]byte{'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
			},
		},
		seqTest{
			[]byte{'\x1b', 'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModAlt},
			},
		},
		seqTest{
			[]byte{'a', 'a', 'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
				KeyPressEvent{Code: 'a', Text: "a"},
				KeyPressEvent{Code: 'a', Text: "a"},
			},
		},
		// Multi-byte rune.
		seqTest{
			[]byte("☃"),
			[]Event{
				KeyPressEvent{Code: '☃', Text: "☃"},
			},
		},
		seqTest{
			[]byte("\x1b☃"),
			[]Event{
				KeyPressEvent{Code: '☃', Mod: ModAlt},
			},
		},
		// Standalone control characters.
		seqTest{
			[]byte{'\x1b'},
			[]Event{
				KeyPressEvent{Code: KeyEscape},
			},
		},
		seqTest{
			[]byte{ansi.SOH},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModCtrl},
			},
		},
		seqTest{
			[]byte{'\x1b', ansi.SOH},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModCtrl | ModAlt},
			},
		},
		seqTest{
			[]byte{ansi.NUL},
			[]Event{
				KeyPressEvent{Code: KeySpace, Mod: ModCtrl},
			},
		},
		seqTest{
			[]byte{'\x1b', ansi.NUL},
			[]Event{
				KeyPressEvent{Code: KeySpace, Mod: ModCtrl | ModAlt},
			},
		},
		// C1 control characters.
		seqTest{
			[]byte{'\x80'},
			[]Event{
				KeyPressEvent{Code: rune(0x80 - '@'), Mod: ModCtrl | ModAlt},
			},
		},
	)

	if runtime.GOOS != "windows" {
		// Sadly, utf8.DecodeRune([]byte(0xfe)) returns a valid rune on windows.
		// This is incorrect, but it makes our test fail if we try it out.
		td = append(td, seqTest{
			[]byte{'\xfe'},
			[]Event{
				UnknownEvent(rune(0xfe)),
			},
		})
	}

	var p Parser
	for _, tc := range td {
		t.Run(fmt.Sprintf("%q", string(tc.seq)), func(t *testing.T) {
			var events []Event
			buf := tc.seq
			for len(buf) > 0 {
				width, Event := p.parseSequence(buf)
				switch Event := Event.(type) {
				case MultiEvent:
					events = append(events, Event...)
				default:
					events = append(events, Event)
				}
				buf = buf[width:]
			}
			if !reflect.DeepEqual(tc.Events, events) {
				t.Errorf("\nexpected event for %q:\n    %#v\ngot:\n    %#v", tc.seq, tc.Events, events)
			}
		})
	}
}

func TestReadLongInput(t *testing.T) {
	expect := make([]Event, 1000)
	for i := range 1000 {
		expect[i] = KeyPressEvent{Code: 'a', Text: "a"}
	}
	input := strings.Repeat("a", 1000)
	drv, err := NewReader(strings.NewReader(input), "dumb", 0)
	if err != nil {
		t.Fatalf("unexpected input driver error: %v", err)
	}

	var Events []Event
	for {
		events, err := drv.ReadEvents()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("unexpected input error: %v", err)
		}
		Events = append(Events, events...)
	}

	if !reflect.DeepEqual(expect, Events) {
		t.Errorf("unexpected messages, expected:\n    %+v\ngot:\n    %+v", expect, Events)
	}
}

func TestReadInput(t *testing.T) {
	type test struct {
		keyname string
		in      []byte
		out     []Event
	}
	testData := []test{
		{
			"a",
			[]byte{'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
			},
		},
		{
			"space",
			[]byte{' '},
			[]Event{
				KeyPressEvent{Code: KeySpace, Text: " "},
			},
		},
		{
			"a alt+a",
			[]byte{'a', '\x1b', 'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
				KeyPressEvent{Code: 'a', Mod: ModAlt},
			},
		},
		{
			"a alt+a a",
			[]byte{'a', '\x1b', 'a', 'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
				KeyPressEvent{Code: 'a', Mod: ModAlt},
				KeyPressEvent{Code: 'a', Text: "a"},
			},
		},
		{
			"ctrl+a",
			[]byte{byte(ansi.SOH)},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModCtrl},
			},
		},
		{
			"ctrl+a ctrl+b",
			[]byte{byte(ansi.SOH), byte(ansi.STX)},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModCtrl},
				KeyPressEvent{Code: 'b', Mod: ModCtrl},
			},
		},
		{
			"alt+a",
			[]byte{byte(0x1b), 'a'},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModAlt},
			},
		},
		{
			"a b c d",
			[]byte{'a', 'b', 'c', 'd'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
				KeyPressEvent{Code: 'b', Text: "b"},
				KeyPressEvent{Code: 'c', Text: "c"},
				KeyPressEvent{Code: 'd', Text: "d"},
			},
		},
		{
			"up",
			[]byte("\x1b[A"),
			[]Event{
				KeyPressEvent{Code: KeyUp},
			},
		},
		{
			"wheel up",
			[]byte{'\x1b', '[', 'M', byte(32) + 0b0100_0000, byte(65), byte(49)},
			[]Event{
				MouseWheelEvent{X: 32, Y: 16, Button: MouseWheelUp},
			},
		},
		{
			"left motion release",
			[]byte{
				'\x1b', '[', 'M', byte(32) + 0b0010_0000, byte(32 + 33), byte(16 + 33),
				'\x1b', '[', 'M', byte(32) + 0b0000_0011, byte(64 + 33), byte(32 + 33),
			},
			[]Event{
				MouseMotionEvent{X: 32, Y: 16, Button: MouseLeft},
				MouseReleaseEvent{X: 64, Y: 32, Button: MouseNone},
			},
		},
		{
			"shift+tab",
			[]byte{'\x1b', '[', 'Z'},
			[]Event{
				KeyPressEvent{Code: KeyTab, Mod: ModShift},
			},
		},
		{
			"enter",
			[]byte{'\r'},
			[]Event{KeyPressEvent{Code: KeyEnter}},
		},
		{
			"alt+enter",
			[]byte{'\x1b', '\r'},
			[]Event{
				KeyPressEvent{Code: KeyEnter, Mod: ModAlt},
			},
		},
		{
			"insert",
			[]byte{'\x1b', '[', '2', '~'},
			[]Event{
				KeyPressEvent{Code: KeyInsert},
			},
		},
		{
			"ctrl+alt+a",
			[]byte{'\x1b', byte(ansi.SOH)},
			[]Event{
				KeyPressEvent{Code: 'a', Mod: ModCtrl | ModAlt},
			},
		},
		{
			"CSI?----X?",
			[]byte{'\x1b', '[', '-', '-', '-', '-', 'X'},
			[]Event{UnknownEvent([]byte{'\x1b', '[', '-', '-', '-', '-', 'X'})},
		},
		// Powershell sequences.
		{
			"up",
			[]byte{'\x1b', 'O', 'A'},
			[]Event{KeyPressEvent{Code: KeyUp}},
		},
		{
			"down",
			[]byte{'\x1b', 'O', 'B'},
			[]Event{KeyPressEvent{Code: KeyDown}},
		},
		{
			"right",
			[]byte{'\x1b', 'O', 'C'},
			[]Event{KeyPressEvent{Code: KeyRight}},
		},
		{
			"left",
			[]byte{'\x1b', 'O', 'D'},
			[]Event{KeyPressEvent{Code: KeyLeft}},
		},
		{
			"alt+enter",
			[]byte{'\x1b', '\x0d'},
			[]Event{KeyPressEvent{Code: KeyEnter, Mod: ModAlt}},
		},
		{
			"alt+backspace",
			[]byte{'\x1b', '\x7f'},
			[]Event{KeyPressEvent{Code: KeyBackspace, Mod: ModAlt}},
		},
		{
			"ctrl+space",
			[]byte{'\x00'},
			[]Event{KeyPressEvent{Code: KeySpace, Mod: ModCtrl}},
		},
		{
			"ctrl+alt+space",
			[]byte{'\x1b', '\x00'},
			[]Event{KeyPressEvent{Code: KeySpace, Mod: ModCtrl | ModAlt}},
		},
		{
			"esc",
			[]byte{'\x1b'},
			[]Event{KeyPressEvent{Code: KeyEscape}},
		},
		{
			"alt+esc",
			[]byte{'\x1b', '\x1b'},
			[]Event{KeyPressEvent{Code: KeyEscape, Mod: ModAlt}},
		},
		{
			"a b o",
			[]byte{
				'\x1b', '[', '2', '0', '0', '~',
				'a', ' ', 'b',
				'\x1b', '[', '2', '0', '1', '~',
				'o',
			},
			[]Event{
				PasteStartEvent{},
				PasteEvent("a b"),
				PasteEndEvent{},
				KeyPressEvent{Code: 'o', Text: "o"},
			},
		},
		{
			"a\x03\nb",
			[]byte{
				'\x1b', '[', '2', '0', '0', '~',
				'a', '\x03', '\n', 'b',
				'\x1b', '[', '2', '0', '1', '~',
			},
			[]Event{
				PasteStartEvent{},
				PasteEvent("a\x03\nb"),
				PasteEndEvent{},
			},
		},
		{
			"?0xfe?",
			[]byte{'\xfe'},
			[]Event{
				UnknownEvent(rune(0xfe)),
			},
		},
		{
			"a ?0xfe?   b",
			[]byte{'a', '\xfe', ' ', 'b'},
			[]Event{
				KeyPressEvent{Code: 'a', Text: "a"},
				UnknownEvent(rune(0xfe)),
				KeyPressEvent{Code: KeySpace, Text: " "},
				KeyPressEvent{Code: 'b', Text: "b"},
			},
		},
	}

	for i, td := range testData {
		t.Run(fmt.Sprintf("%d: %s", i, td.keyname), func(t *testing.T) {
			Events := testReadInputs(t, bytes.NewReader(td.in))
			var buf strings.Builder
			for i, Event := range Events {
				if i > 0 {
					buf.WriteByte(' ')
				}
				if s, ok := Event.(fmt.Stringer); ok {
					buf.WriteString(s.String())
				} else {
					fmt.Fprintf(&buf, "%#v:%T", Event, Event)
				}
			}

			if len(Events) != len(td.out) {
				t.Fatalf("unexpected message list length: got %d, expected %d\n  got: %#v\n  expected: %#v\n", len(Events), len(td.out), Events, td.out)
			}

			if !reflect.DeepEqual(td.out, Events) {
				t.Fatalf("expected:\n%#v\ngot:\n%#v", td.out, Events)
			}
		})
	}
}

func testReadInputs(t *testing.T, input io.Reader) []Event {
	// We'll check that the input reader finishes at the end
	// without error.
	var wg sync.WaitGroup
	var inputErr error
	ctx, cancel := context.WithCancel(context.Background())
	defer func() {
		cancel()
		wg.Wait()
		if inputErr != nil && !errors.Is(inputErr, io.EOF) {
			t.Fatalf("unexpected input error: %v", inputErr)
		}
	}()

	dr, err := NewReader(input, "dumb", 0)
	if err != nil {
		t.Fatalf("unexpected input driver error: %v", err)
	}

	// The messages we're consuming.
	EventsC := make(chan Event)

	// Start the reader in the background.
	wg.Add(1)
	go func() {
		defer wg.Done()
		var events []Event
		events, inputErr = dr.ReadEvents()
	out:
		for _, ev := range events {
			select {
			case EventsC <- ev:
			case <-ctx.Done():
				break out
			}
		}
		EventsC <- nil
	}()

	var Events []Event
loop:
	for {
		select {
		case Event := <-EventsC:
			if Event == nil {
				// end of input marker for the test.
				break loop
			}
			Events = append(Events, Event)
		case <-time.After(2 * time.Second):
			t.Errorf("timeout waiting for input event")
			break loop
		}
	}
	return Events
}

// randTest defines the test input and expected output for a sequence
// of interleaved control sequences and control characters.
type randTest struct {
	data    []byte
	lengths []int
	names   []string
}

// seed is the random seed to randomize the input. This helps check
// that all the sequences get ultimately exercised.
var seed = flag.Int64("seed", 0, "random seed (0 to autoselect)")

// genRandomData generates a randomized test, with a random seed unless
// the seed flag was set.
func genRandomData(logfn func(int64), length int) randTest {
	// We'll use a random source. However, we give the user the option
	// to override it to a specific value for reproduceability.
	s := *seed
	if s == 0 {
		s = time.Now().UnixNano()
	}
	// Inform the user so they know what to reuse to get the same data.
	logfn(s)
	return genRandomDataWithSeed(s, length)
}

// genRandomDataWithSeed generates a randomized test with a fixed seed.
func genRandomDataWithSeed(s int64, length int) randTest {
	src := rand.NewSource(s)
	r := rand.New(src)

	// allseqs contains all the sequences, in sorted order. We sort
	// to make the test deterministic (when the seed is also fixed).
	type seqpair struct {
		seq  string
		name string
	}
	var allseqs []seqpair
	for seq, key := range sequences {
		allseqs = append(allseqs, seqpair{seq, key.String()})
	}
	sort.Slice(allseqs, func(i, j int) bool { return allseqs[i].seq < allseqs[j].seq })

	// res contains the computed test.
	var res randTest

	for len(res.data) < length {
		alt := r.Intn(2)
		prefix := ""
		esclen := 0
		if alt == 1 {
			prefix = "alt+"
			esclen = 1
		}
		kind := r.Intn(3)
		switch kind {
		case 0:
			// A control character.
			if alt == 1 {
				res.data = append(res.data, '\x1b')
			}
			res.data = append(res.data, 1)
			res.names = append(res.names, "ctrl+"+prefix+"a")
			res.lengths = append(res.lengths, 1+esclen)

		case 1, 2:
			// A sequence.
			seqi := r.Intn(len(allseqs))
			s := allseqs[seqi]
			if strings.Contains(s.name, "alt+") || strings.Contains(s.name, "meta+") {
				esclen = 0
				prefix = ""
				alt = 0
			}
			if alt == 1 {
				res.data = append(res.data, '\x1b')
			}
			res.data = append(res.data, s.seq...)
			if strings.HasPrefix(s.name, "ctrl+") {
				prefix = "ctrl+" + prefix
			}
			name := prefix + strings.TrimPrefix(s.name, "ctrl+")
			res.names = append(res.names, name)
			res.lengths = append(res.lengths, len(s.seq)+esclen)
		}
	}
	return res
}

func FuzzParseSequence(f *testing.F) {
	var p Parser
	for seq := range sequences {
		f.Add(seq)
	}
	f.Add("\x1b]52;?\x07")                      // OSC 52
	f.Add("\x1b]11;rgb:0000/0000/0000\x1b\\")   // OSC 11
	f.Add("\x1bP>|charm terminal(0.1.2)\x1b\\") // DCS (XTVERSION)
	f.Add("\x1b_Gi=123\x1b\\")                  // APC
	f.Fuzz(func(t *testing.T, seq string) {
		n, _ := p.parseSequence([]byte(seq))
		if n == 0 && seq != "" {
			t.Errorf("expected a non-zero width for %q", seq)
		}
	})
}

// BenchmarkDetectSequenceMap benchmarks the map-based sequence
// detector.
func BenchmarkDetectSequenceMap(b *testing.B) {
	var p Parser
	td := genRandomDataWithSeed(123, 10000)
	for i := 0; i < b.N; i++ {
		for j, w := 0, 0; j < len(td.data); j += w {
			w, _ = p.parseSequence(td.data[j:])
		}
	}
}
