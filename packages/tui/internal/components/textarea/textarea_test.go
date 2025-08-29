package textarea

import (
	"testing"

	"github.com/sst/opencode/internal/attachment"
)

func TestRemoveAttachmentAtCursor_ConvertsToText_WhenCursorAfterAttachment(t *testing.T) {
	m := New()
	m.InsertString("a ")
	att := &attachment.Attachment{ID: "1", Display: "@file.txt"}
	m.InsertAttachment(att)
	m.InsertString(" b")

	// Position cursor immediately after the attachment (index 3: 'a',' ',att,' ', 'b')
	m.SetCursorColumn(3)

	if ok := m.removeAttachmentAtCursor(); !ok {
		t.Fatalf("expected removal to occur")
	}
	got := m.Value()
	want := "a @file.txt b"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestRemoveAttachmentAtCursor_ConvertsToText_WhenCursorOnAttachment(t *testing.T) {
	m := New()
	m.InsertString("x ")
	att := &attachment.Attachment{ID: "2", Display: "@img.png"}
	m.InsertAttachment(att)
	m.InsertString(" y")

	// Position cursor on the attachment token (index 2: 'x',' ',att,' ', 'y')
	m.SetCursorColumn(2)

	if ok := m.removeAttachmentAtCursor(); !ok {
		t.Fatalf("expected removal to occur")
	}
	got := m.Value()
	want := "x @img.png y"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

func TestRemoveAttachmentAtCursor_StartOfLine(t *testing.T) {
	m := New()
	att := &attachment.Attachment{ID: "3", Display: "@a.txt"}
	m.InsertAttachment(att)
	m.InsertString(" tail")

	// Position cursor immediately after the attachment at start of line (index 1)
	m.SetCursorColumn(1)
	if ok := m.removeAttachmentAtCursor(); !ok {
		t.Fatalf("expected removal to occur at start of line")
	}
	if got := m.Value(); got != "@a.txt tail" {
		t.Fatalf("unexpected value: %q", got)
	}
}

func TestRemoveAttachmentAtCursor_NoAttachment_NoChange(t *testing.T) {
	m := New()
	m.InsertString("hello world")
	col := m.CursorColumn()
	if ok := m.removeAttachmentAtCursor(); ok {
		t.Fatalf("did not expect removal to occur")
	}
	if m.Value() != "hello world" || m.CursorColumn() != col {
		t.Fatalf("value or cursor unexpectedly changed")
	}
}
