package rangemap

import (
	"testing"
)

func TestRangeMapBasic(t *testing.T) {
	rm := New[string]()
	
	// Test empty map
	if !rm.IsEmpty() {
		t.Error("New map should be empty")
	}
	
	// Insert ranges
	testCases := []struct {
		r     Range
		value string
	}{
		{Range{10, 20}, "A"},
		{Range{30, 40}, "B"},
		{Range{15, 25}, "C"}, // Overlaps with A
		{Range{50, 60}, "D"},
	}
	
	for _, tc := range testCases {
		if err := rm.Insert(tc.r, tc.value); err != nil {
			t.Errorf("Failed to insert range %v: %v", tc.r, err)
		}
	}
	
	if rm.Len() != len(testCases) {
		t.Errorf("Map should have %d ranges, got %d", len(testCases), rm.Len())
	}
	
	// Test point queries
	pointTests := []struct {
		pos      int
		expected string
		found    bool
	}{
		{5, "", false},
		{10, "A", true},
		{15, "A", true}, // Could also be "C"
		{19, "A", true},
		{20, "C", true},
		{25, "", false},
		{35, "B", true},
		{45, "", false},
		{55, "D", true},
		{65, "", false},
	}
	
	for _, tt := range pointTests {
		value, found := rm.Get(tt.pos)
		if found != tt.found {
			t.Errorf("Get(%d): expected found=%v, got %v", tt.pos, tt.found, found)
		}
		if found && value != tt.expected {
			t.Errorf("Get(%d): expected value=%q, got %q", tt.pos, tt.expected, value)
		}
	}
}

func TestRangeMapNoOverlap(t *testing.T) {
	rm := NewNoOverlap[int]()
	
	// Insert non-overlapping ranges
	if err := rm.Insert(Range{10, 20}, 1); err != nil {
		t.Errorf("Failed to insert first range: %v", err)
	}
	
	if err := rm.Insert(Range{30, 40}, 2); err != nil {
		t.Errorf("Failed to insert non-overlapping range: %v", err)
	}
	
	// Try to insert overlapping range
	if err := rm.Insert(Range{15, 25}, 3); err == nil {
		t.Error("Should not allow overlapping range")
	}
	
	// Insert adjacent range (should be allowed)
	if err := rm.Insert(Range{20, 30}, 4); err != nil {
		t.Errorf("Failed to insert adjacent range: %v", err)
	}
}

func TestRangeMapGetAll(t *testing.T) {
	rm := New[string]()
	
	// Insert overlapping ranges
	rm.Insert(Range{10, 30}, "A")
	rm.Insert(Range{20, 40}, "B")
	rm.Insert(Range{25, 35}, "C")
	rm.Insert(Range{50, 60}, "D")
	
	// Test GetAll
	tests := []struct {
		pos      int
		expected []string
	}{
		{5, []string{}},
		{15, []string{"A"}},
		{25, []string{"A", "B", "C"}},
		{35, []string{"B"}},
		{55, []string{"D"}},
	}
	
	for _, tt := range tests {
		values := rm.GetAll(tt.pos)
		if len(values) != len(tt.expected) {
			t.Errorf("GetAll(%d): expected %d values, got %d", tt.pos, len(tt.expected), len(values))
			continue
		}
		
		// Create a map for easy checking
		found := make(map[string]bool)
		for _, v := range values {
			found[v] = true
		}
		
		for _, exp := range tt.expected {
			if !found[exp] {
				t.Errorf("GetAll(%d): missing expected value %q", tt.pos, exp)
			}
		}
	}
}

func TestRangeMapGetOverlapping(t *testing.T) {
	rm := New[string]()
	
	// Insert ranges
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{15, 25}, "B")
	rm.Insert(Range{30, 40}, "C")
	rm.Insert(Range{35, 45}, "D")
	rm.Insert(Range{50, 60}, "E")
	
	tests := []struct {
		query    Range
		expected []string
	}{
		{Range{5, 9}, []string{}},
		{Range{5, 15}, []string{"A"}},
		{Range{12, 18}, []string{"A", "B"}},
		{Range{22, 28}, []string{"B"}},
		{Range{25, 35}, []string{"C"}},
		{Range{0, 100}, []string{"A", "B", "C", "D", "E"}},
	}
	
	for _, tt := range tests {
		overlaps := rm.GetOverlapping(tt.query)
		if len(overlaps) != len(tt.expected) {
			t.Errorf("GetOverlapping(%v): expected %d ranges, got %d", 
				tt.query, len(tt.expected), len(overlaps))
			continue
		}
		
		// Check values
		found := make(map[string]bool)
		for _, entry := range overlaps {
			found[entry.Value] = true
		}
		
		for _, exp := range tt.expected {
			if !found[exp] {
				t.Errorf("GetOverlapping(%v): missing expected value %q", tt.query, exp)
			}
		}
	}
}

func TestRangeMapGetInRange(t *testing.T) {
	rm := New[string]()
	
	// Insert ranges
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{15, 18}, "B")
	rm.Insert(Range{30, 40}, "C")
	rm.Insert(Range{32, 38}, "D")
	rm.Insert(Range{50, 80}, "E")
	
	tests := []struct {
		query    Range
		expected []string
	}{
		{Range{0, 100}, []string{"A", "B", "C", "D", "E"}},
		{Range{10, 20}, []string{"A", "B"}},
		{Range{14, 19}, []string{"B"}},
		{Range{30, 45}, []string{"C", "D"}},
		{Range{60, 70}, []string{}}, // E is not completely contained
	}
	
	for _, tt := range tests {
		entries := rm.GetInRange(tt.query)
		if len(entries) != len(tt.expected) {
			t.Errorf("GetInRange(%v): expected %d ranges, got %d", 
				tt.query, len(tt.expected), len(entries))
			continue
		}
		
		// Check values
		found := make(map[string]bool)
		for _, entry := range entries {
			found[entry.Value] = true
		}
		
		for _, exp := range tt.expected {
			if !found[exp] {
				t.Errorf("GetInRange(%v): missing expected value %q", tt.query, exp)
			}
		}
	}
}

func TestRangeMapDelete(t *testing.T) {
	rm := New[string]()
	
	// Insert ranges
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{10, 20}, "A2") // This replaces the first entry
	rm.Insert(Range{30, 40}, "B")
	
	// Verify initial state
	if rm.Len() != 2 {
		t.Errorf("Map should have 2 ranges, got %d", rm.Len())
	}
	
	// Delete non-existent range
	count := rm.Delete(Range{5, 15})
	if count != 0 {
		t.Errorf("Delete of non-existent range should return 0, got %d", count)
	}
	
	// Delete existing range
	count = rm.Delete(Range{10, 20})
	if count != 1 {
		t.Errorf("Delete should have removed 1 range (duplicates are replaced), got %d", count)
	}
	
	if rm.Len() != 1 {
		t.Errorf("Map should have 1 range left, got %d", rm.Len())
	}
	
	// Verify correct range remains
	val, found := rm.Get(35)
	if !found || val != "B" {
		t.Error("Range B should still exist")
	}
	
	// Test deleting with multiple distinct ranges with same bounds
	rm.Clear()
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{10, 25}, "B") // Different end
	rm.Insert(Range{15, 20}, "C") // Different start
	
	count = rm.Delete(Range{10, 20})
	if count != 1 {
		t.Errorf("Delete should remove exactly matching range only, got %d", count)
	}
	
	// Verify other ranges still exist
	if rm.Len() != 2 {
		t.Errorf("Should have 2 ranges left, got %d", rm.Len())
	}
}

func TestRangeMapCoalesce(t *testing.T) {
	rm := New[int]()
	
	// Insert adjacent and overlapping ranges with same value
	rm.Insert(Range{10, 20}, 1)
	rm.Insert(Range{20, 30}, 1)
	rm.Insert(Range{25, 35}, 1)
	rm.Insert(Range{40, 50}, 2)
	rm.Insert(Range{50, 60}, 2)
	rm.Insert(Range{70, 80}, 1)
	
	// Coalesce with simple equality
	rm.Coalesce(
		func(a, b int) bool { return a == b },
		func(a, b int) int { return a }, // Keep first value
	)
	
	// Should have 3 ranges now: [10,35), [40,60), [70,80)
	if rm.Len() != 3 {
		t.Errorf("After coalesce should have 3 ranges, got %d", rm.Len())
	}
	
	// Verify coalesced ranges
	tests := []struct {
		pos      int
		expected int
		found    bool
	}{
		{15, 1, true},
		{25, 1, true},
		{34, 1, true},
		{35, 0, false},
		{45, 2, true},
		{55, 2, true},
		{75, 1, true},
	}
	
	for _, tt := range tests {
		val, found := rm.Get(tt.pos)
		if found != tt.found {
			t.Errorf("Get(%d): expected found=%v, got %v", tt.pos, tt.found, found)
		}
		if found && val != tt.expected {
			t.Errorf("Get(%d): expected value=%d, got %d", tt.pos, tt.expected, val)
		}
	}
}

func TestRangeMapShift(t *testing.T) {
	rm := New[string]()
	
	// Insert ranges
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{30, 40}, "B")
	rm.Insert(Range{50, 60}, "C")
	
	// Shift everything after position 25 by +10
	rm.Shift(10, 25)
	
	// Verify shifted positions
	tests := []struct {
		pos      int
		expected string
		found    bool
	}{
		{15, "A", true},  // Not shifted
		{35, "", false},  // Gap created by shift
		{40, "B", true},  // B shifted from 30-40 to 40-50
		{45, "B", true},
		{60, "C", true},  // C shifted from 50-60 to 60-70
		{65, "C", true},
	}
	
	for _, tt := range tests {
		val, found := rm.Get(tt.pos)
		if found != tt.found {
			t.Errorf("Get(%d) after shift: expected found=%v, got %v", tt.pos, tt.found, found)
		}
		if found && val != tt.expected {
			t.Errorf("Get(%d) after shift: expected value=%q, got %q", tt.pos, tt.expected, val)
		}
	}
	
	// Test negative shift (deletion)
	rm.Clear()
	rm.Insert(Range{10, 20}, "A")
	rm.Insert(Range{30, 50}, "B")
	rm.Insert(Range{60, 70}, "C")
	
	// Delete 10 characters at position 25
	rm.Shift(-10, 25)
	
	// Range B should be shortened
	val, found := rm.Get(39)
	if !found || val != "B" {
		t.Error("Range B should still exist but be shortened")
	}
	
	val, found = rm.Get(40)
	if found {
		t.Error("Position 40 should be outside shortened range B")
	}
	
	// Range C should be shifted left
	val, found = rm.Get(50)
	if !found || val != "C" {
		t.Error("Range C should be shifted to position 50")
	}
}

func TestRangeMapIterator(t *testing.T) {
	rm := New[string]()
	
	// Insert ranges
	ranges := []struct {
		r     Range
		value string
	}{
		{Range{30, 40}, "B"},
		{Range{10, 20}, "A"},
		{Range{50, 60}, "C"},
		{Range{15, 25}, "D"},
	}
	
	for _, r := range ranges {
		rm.Insert(r.r, r.value)
	}
	
	// Test forward iteration
	iter := rm.Iterator()
	var collected []Entry[string]
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		collected = append(collected, iter.Entry())
	}
	
	if len(collected) != 4 {
		t.Errorf("Iterator should return 4 entries, got %d", len(collected))
	}
	
	// Verify order (by start position)
	for i := 1; i < len(collected); i++ {
		if collected[i-1].Range.Start > collected[i].Range.Start {
			t.Error("Iterator entries not in order by start position")
		}
	}
	
	// Test seek
	if !iter.Seek(35) {
		t.Error("Seek(35) should find entry")
	}
	entry := iter.Entry()
	if entry.Value != "C" {
		t.Errorf("Seek(35) should find entry C, got %v", entry.Value)
	}
}

func TestRangeMapEdgeCases(t *testing.T) {
	rm := New[string]()
	
	// Test empty range
	err := rm.Insert(Range{10, 10}, "A")
	if err == nil {
		t.Error("Should not allow empty range")
	}
	
	// Test inverted range
	err = rm.Insert(Range{20, 10}, "B")
	if err == nil {
		t.Error("Should not allow inverted range")
	}
	
	// Test zero-width operations
	overlaps := rm.GetOverlapping(Range{10, 10})
	if len(overlaps) != 0 {
		t.Error("Empty range should not overlap with anything")
	}
	
	entries := rm.GetInRange(Range{10, 10})
	if len(entries) != 0 {
		t.Error("Empty range should not contain anything")
	}
}

// Benchmarks

func BenchmarkRangeMapInsert(b *testing.B) {
	rm := New[int]()
	b.ResetTimer()
	
	for i := 0; i < b.N; i++ {
		start := i * 10
		rm.Insert(Range{start, start + 5}, i)
	}
}

func BenchmarkRangeMapGet(b *testing.B) {
	rm := New[int]()
	
	// Pre-populate with non-overlapping ranges
	for i := 0; i < 10000; i++ {
		start := i * 10
		rm.Insert(Range{start, start + 5}, i)
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		rm.Get(i % 100000)
	}
}

func BenchmarkRangeMapGetOverlapping(b *testing.B) {
	rm := New[int]()
	
	// Pre-populate with some overlapping ranges
	for i := 0; i < 1000; i++ {
		start := i * 5
		rm.Insert(Range{start, start + 10}, i)
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := (i % 1000) * 5
		rm.GetOverlapping(Range{start, start + 20})
	}
}