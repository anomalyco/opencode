package vim

import (
	"testing"
)

func TestCommandParser_ParseMotion(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantMotion *Motion
		wantCount  int
		wantRest   string
	}{
		// Basic motions
		{
			name:  "h motion",
			input: "h",
			wantMotion: &Motion{
				Type:      MotionLeft,
				Count:     1,
				Inclusive: false,
				Direction: -1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "j motion",
			input: "j",
			wantMotion: &Motion{
				Type:      MotionDown,
				Count:     1,
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "w motion",
			input: "w",
			wantMotion: &Motion{
				Type:      MotionWord,
				Count:     1,
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "$ motion (inclusive)",
			input: "$",
			wantMotion: &Motion{
				Type:      MotionLineEnd,
				Count:     1,
				Inclusive: true,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		// Motions with count
		{
			name:  "3j motion",
			input: "3j",
			wantMotion: &Motion{
				Type:      MotionDown,
				Count:     3,
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 3,
			wantRest:  "",
		},
		{
			name:  "10w motion",
			input: "10w",
			wantMotion: &Motion{
				Type:      MotionWord,
				Count:     10,
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 10,
			wantRest:  "",
		},
		// Character search motions
		{
			name:  "fx motion",
			input: "fx",
			wantMotion: &Motion{
				Type:      MotionFindChar,
				Count:     1,
				Char:      'x',
				Inclusive: true,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "Fx motion",
			input: "Fx",
			wantMotion: &Motion{
				Type:      MotionFindCharBack,
				Count:     1,
				Char:      'x',
				Inclusive: true,
				Direction: -1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "tx motion",
			input: "tx",
			wantMotion: &Motion{
				Type:      MotionTillChar,
				Count:     1,
				Char:      'x',
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "2fa motion",
			input: "2fa",
			wantMotion: &Motion{
				Type:      MotionFindChar,
				Count:     2,
				Char:      'a',
				Inclusive: true,
				Direction: 1,
			},
			wantCount: 2,
			wantRest:  "",
		},
		// Text objects
		{
			name:  "iw text object",
			input: "iw",
			wantMotion: &Motion{
				Type:      MotionInnerWord,
				Count:     1,
				Inclusive: true,
				Direction: 0,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "aw text object",
			input: "aw",
			wantMotion: &Motion{
				Type:      MotionAroundWord,
				Count:     1,
				Inclusive: true,
				Direction: 0,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "i\" text object",
			input: "i\"",
			wantMotion: &Motion{
				Type:      MotionInnerQuotes,
				Count:     1,
				Inclusive: true,
				Direction: 0,
			},
			wantCount: 1,
			wantRest:  "",
		},
		// Special motions
		{
			name:  "gg motion",
			input: "gg",
			wantMotion: &Motion{
				Type:      MotionFileStart,
				Count:     1,
				Inclusive: false,
				Direction: -1,
			},
			wantCount: 1,
			wantRest:  "",
		},
		{
			name:  "G motion",
			input: "G",
			wantMotion: &Motion{
				Type:      MotionFileEnd,
				Count:     1,
				Inclusive: false,
				Direction: 1,
			},
			wantCount: 1,
			wantRest:  "",
		},
	}

	parser := NewCommandParser()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotMotion, gotRest := parser.ParseMotion(tt.input, tt.wantCount)
			
			if gotMotion == nil && tt.wantMotion != nil {
				t.Fatal("ParseMotion() returned nil, want motion")
			}
			if gotMotion != nil && tt.wantMotion == nil {
				t.Fatal("ParseMotion() returned motion, want nil")
			}
			if gotMotion != nil && tt.wantMotion != nil {
				if gotMotion.Type != tt.wantMotion.Type {
					t.Errorf("Motion.Type = %v, want %v", gotMotion.Type, tt.wantMotion.Type)
				}
				if gotMotion.Count != tt.wantMotion.Count {
					t.Errorf("Motion.Count = %v, want %v", gotMotion.Count, tt.wantMotion.Count)
				}
				if gotMotion.Inclusive != tt.wantMotion.Inclusive {
					t.Errorf("Motion.Inclusive = %v, want %v", gotMotion.Inclusive, tt.wantMotion.Inclusive)
				}
				if gotMotion.Direction != tt.wantMotion.Direction {
					t.Errorf("Motion.Direction = %v, want %v", gotMotion.Direction, tt.wantMotion.Direction)
				}
				if gotMotion.Char != tt.wantMotion.Char {
					t.Errorf("Motion.Char = %v, want %v", gotMotion.Char, tt.wantMotion.Char)
				}
			}
			if gotRest != tt.wantRest {
				t.Errorf("ParseMotion() rest = %v, want %v", gotRest, tt.wantRest)
			}
		})
	}
}

func TestCommandParser_ParseCommand(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantCommand *Command
		wantErr     bool
	}{
		// Simple commands
		{
			name:  "x command",
			input: "x",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionRight,
					Count:     1,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		{
			name:  "s command",
			input: "s",
			wantCommand: &Command{
				Type:     CommandSubstitute,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionRight,
					Count:     1,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		{
			name:  "D command",
			input: "D",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLineEnd,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			},
		},
		{
			name:  "C command",
			input: "C",
			wantCommand: &Command{
				Type:     CommandChange,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLineEnd,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			},
		},
		// Commands with motion
		{
			name:  "dw command",
			input: "dw",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionWord,
					Count:     1,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		{
			name:  "c$ command",
			input: "c$",
			wantCommand: &Command{
				Type:     CommandChange,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLineEnd,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			},
		},
		{
			name:  "yiw command",
			input: "yiw",
			wantCommand: &Command{
				Type:     CommandYank,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionInnerWord,
					Count:     1,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		// Commands with count
		{
			name:  "3x command",
			input: "3x",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    3,
				Register: "",
				Motion: &Motion{
					Type:      MotionRight,
					Count:     3,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		{
			name:  "2dw command",
			input: "2dw",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    2,
				Register: "",
				Motion: &Motion{
					Type:      MotionWord,
					Count:     2,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		// Doubled operators
		{
			name:  "dd command",
			input: "dd",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLine,
					Count:     1,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		{
			name:  "cc command",
			input: "cc",
			wantCommand: &Command{
				Type:     CommandChange,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLine,
					Count:     1,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		{
			name:  "yy command",
			input: "yy",
			wantCommand: &Command{
				Type:     CommandYank,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionLine,
					Count:     1,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		{
			name:  "2dd command",
			input: "2dd",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    2,
				Register: "",
				Motion: &Motion{
					Type:      MotionLine,
					Count:     2,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		// Commands with register
		{
			name:  "\"adw command",
			input: "\"adw",
			wantCommand: &Command{
				Type:     CommandDelete,
				Count:    1,
				Register: "a",
				Motion: &Motion{
					Type:      MotionWord,
					Count:     1,
					Inclusive: false,
					Direction: 1,
				},
			},
		},
		{
			name:  "\"+yy command",
			input: "\"+yy",
			wantCommand: &Command{
				Type:     CommandYank,
				Count:    1,
				Register: "+",
				Motion: &Motion{
					Type:      MotionLine,
					Count:     1,
					Inclusive: true,
					Direction: 0,
				},
			},
		},
		// Special case: cw should behave like ce
		{
			name:  "cw command (special case)",
			input: "cw",
			wantCommand: &Command{
				Type:     CommandChange,
				Count:    1,
				Register: "",
				Motion: &Motion{
					Type:      MotionEndWord,
					Count:     1,
					Inclusive: true,
					Direction: 1,
				},
			},
		},
		// Put commands
		{
			name:  "p command",
			input: "p",
			wantCommand: &Command{
				Type:     CommandPut,
				Count:    1,
				Register: "",
			},
		},
		{
			name:  "P command",
			input: "P",
			wantCommand: &Command{
				Type:     CommandPutBefore,
				Count:    1,
				Register: "",
			},
		},
		// Other commands
		{
			name:  "u command",
			input: "u",
			wantCommand: &Command{
				Type:  CommandUndo,
				Count: 1,
			},
		},
		{
			name:  "ctrl+r command",
			input: "\x12", // Ctrl+R
			wantCommand: &Command{
				Type:  CommandRedo,
				Count: 1,
			},
		},
		{
			name:  ". command",
			input: ".",
			wantCommand: &Command{
				Type:  CommandRepeat,
				Count: 1,
			},
		},
	}

	parser := NewCommandParser()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotCommand, err := parser.ParseCommand(tt.input)
			
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseCommand() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			
			if gotCommand == nil && tt.wantCommand != nil {
				t.Fatal("ParseCommand() returned nil, want command")
			}
			if gotCommand != nil && tt.wantCommand == nil {
				t.Fatal("ParseCommand() returned command, want nil")
			}
			if gotCommand != nil && tt.wantCommand != nil {
				if gotCommand.Type != tt.wantCommand.Type {
					t.Errorf("Command.Type = %v, want %v", gotCommand.Type, tt.wantCommand.Type)
				}
				if gotCommand.Count != tt.wantCommand.Count {
					t.Errorf("Command.Count = %v, want %v", gotCommand.Count, tt.wantCommand.Count)
				}
				if gotCommand.Register != tt.wantCommand.Register {
					t.Errorf("Command.Register = %v, want %v", gotCommand.Register, tt.wantCommand.Register)
				}
				if gotCommand.Motion != nil && tt.wantCommand.Motion != nil {
					if gotCommand.Motion.Type != tt.wantCommand.Motion.Type {
						t.Errorf("Motion.Type = %v, want %v", gotCommand.Motion.Type, tt.wantCommand.Motion.Type)
					}
					if gotCommand.Motion.Count != tt.wantCommand.Motion.Count {
						t.Errorf("Motion.Count = %v, want %v", gotCommand.Motion.Count, tt.wantCommand.Motion.Count)
					}
				}
			}
		})
	}
}

func TestCommandParser_ShouldMarkText(t *testing.T) {
	tests := []struct {
		name    string
		command string
		want    bool
	}{
		{"x marks text", "x", true},
		{"s marks text", "s", true},
		{"d does not mark", "d", false},
		{"c does not mark", "c", false},
		{"y does not mark", "y", false},
		{"p does not mark", "p", false},
	}

	parser := NewCommandParser()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parser.ShouldMarkText(tt.command); got != tt.want {
				t.Errorf("ShouldMarkText(%s) = %v, want %v", tt.command, got, tt.want)
			}
		})
	}
}

func TestCommandParser_ExtractCount(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantCount int
		wantRest  string
	}{
		{"no count", "dw", 1, "dw"},
		{"single digit", "3dw", 3, "dw"},
		{"double digit", "12j", 12, "j"},
		{"triple digit", "100x", 100, "x"},
		{"zero not count", "0", 1, "0"},
		{"zero after digit", "10w", 10, "w"},
	}

	parser := NewCommandParser()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotCount, gotRest := parser.extractCount(tt.input)
			if gotCount != tt.wantCount {
				t.Errorf("extractCount() count = %v, want %v", gotCount, tt.wantCount)
			}
			if gotRest != tt.wantRest {
				t.Errorf("extractCount() rest = %v, want %v", gotRest, tt.wantRest)
			}
		})
	}
}