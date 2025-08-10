package vim

import (
	"fmt"
	"testing"
)

func TestDebugBackwardWord(t *testing.T) {
	buffer := [][]rune{{'h', 'e', 'l', 'l', 'o', ' ', 'w', 'o', 'r', 'l', 'd'}}
	startPos := Position{Row: 0, Col: 7} // 'w' in "world"
	
	// Convert to any buffer
	anyBuffer := make([][]any, len(buffer))
	for i, row := range buffer {
		anyBuffer[i] = make([]any, len(row))
		for j, r := range row {
			anyBuffer[i][j] = r
		}
	}
	
	engine := NewMotionEngine()
	motion := Motion{Type: MotionBackWord, Count: 1}
	
	fmt.Printf("Buffer: %s\n", string(buffer[0]))
	fmt.Printf("Start position: %v (char: %c)\n", startPos, buffer[startPos.Row][startPos.Col])
	
	result := engine.Execute(anyBuffer, startPos, motion)
	fmt.Printf("Result position: %v", result)
	if result.Col < len(buffer[0]) {
		fmt.Printf(" (char: %c)", buffer[result.Row][result.Col])
	}
	fmt.Println()
	
	// The test expects position 0 (start of "hello")
	// But we're getting position 6 (start of "world")
	// This means the backward word motion is not going to the PREVIOUS word
	
	if result.Col != 0 {
		t.Errorf("Expected col 0, got %d", result.Col)
	}
}