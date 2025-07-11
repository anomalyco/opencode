package input

// PasteEvent is an message that is emitted when a terminal receives pasted text
// using bracketed-paste.
type PasteEvent string

// PasteStartEvent is an message that is emitted when the terminal starts the
// bracketed-paste text.
type PasteStartEvent struct{}

// PasteEndEvent is an message that is emitted when the terminal ends the
// bracketed-paste text.
type PasteEndEvent struct{}
