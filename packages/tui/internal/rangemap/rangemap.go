// Package rangemap implements an interval tree using B-trees for efficient
// range queries and overlapping interval detection. This is optimized for
// use cases like syntax highlighting, text annotations, and metadata tracking
// in TUI components.
package rangemap

import (
	"fmt"

	"github.com/sst/opencode/internal/btree"
)

// Range represents an interval with a start and end position.
type Range struct {
	Start, End int
}

// Contains returns true if the range contains the given position.
func (r Range) Contains(pos int) bool {
	return pos >= r.Start && pos < r.End
}

// Overlaps returns true if this range overlaps with another range.
func (r Range) Overlaps(other Range) bool {
	return r.Start < other.End && other.Start < r.End
}

// IsEmpty returns true if the range is empty (start >= end).
func (r Range) IsEmpty() bool {
	return r.Start >= r.End
}

// Len returns the length of the range.
func (r Range) Len() int {
	if r.IsEmpty() {
		return 0
	}
	return r.End - r.Start
}

// Entry represents a range with associated data.
type Entry[T any] struct {
	Range Range
	Value T
}

// Less implements btree.Item for sorting entries by start position.
func (e Entry[T]) Less(other btree.Item) bool {
	o := other.(Entry[T])
	if e.Range.Start != o.Range.Start {
		return e.Range.Start < o.Range.Start
	}
	// For equal starts, sort by end position (larger ranges first)
	return e.Range.End > o.Range.End
}

// RangeMap is an interval tree implementation using B-trees.
type RangeMap[T any] struct {
	tree       *btree.BTree
	allowOverlap bool
}

// New creates a new RangeMap.
func New[T any]() *RangeMap[T] {
	return &RangeMap[T]{
		tree:       btree.New(),
		allowOverlap: true,
	}
}

// NewNoOverlap creates a new RangeMap that doesn't allow overlapping ranges.
func NewNoOverlap[T any]() *RangeMap[T] {
	return &RangeMap[T]{
		tree:       btree.New(),
		allowOverlap: false,
	}
}

// Insert adds a range with associated value to the map.
// If overlapping is not allowed and the range overlaps with existing ranges,
// it returns an error.
func (m *RangeMap[T]) Insert(r Range, value T) error {
	if r.IsEmpty() {
		return fmt.Errorf("cannot insert empty range")
	}

	entry := Entry[T]{Range: r, Value: value}

	if !m.allowOverlap {
		// Check for overlaps
		overlaps := m.GetOverlapping(r)
		if len(overlaps) > 0 {
			return fmt.Errorf("range [%d, %d) overlaps with existing ranges", r.Start, r.End)
		}
	}

	m.tree.Insert(entry)
	return nil
}

// Delete removes all ranges that exactly match the given range.
// Returns the number of ranges deleted.
func (m *RangeMap[T]) Delete(r Range) int {
	count := 0
	// Collect all entries to delete first
	var toDelete []Entry[T]
	
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		if entry.Range == r {
			toDelete = append(toDelete, entry)
		}
	}
	
	// Delete the collected entries
	for _, entry := range toDelete {
		if m.tree.Delete(entry) {
			count++
		}
	}
	
	return count
}

// Get returns the value associated with the first range that contains the position.
func (m *RangeMap[T]) Get(pos int) (T, bool) {
	var zero T
	
	// Find all ranges that could contain pos
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		if entry.Range.Start > pos {
			// No more ranges can contain pos
			break
		}
		if entry.Range.Contains(pos) {
			return entry.Value, true
		}
	}
	
	return zero, false
}

// GetAll returns all values associated with ranges that contain the position.
func (m *RangeMap[T]) GetAll(pos int) []T {
	var results []T
	
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		if entry.Range.Start > pos {
			// No more ranges can contain pos
			break
		}
		if entry.Range.Contains(pos) {
			results = append(results, entry.Value)
		}
	}
	
	return results
}

// GetOverlapping returns all entries that overlap with the given range.
func (m *RangeMap[T]) GetOverlapping(r Range) []Entry[T] {
	if r.IsEmpty() {
		return nil
	}

	var results []Entry[T]
	
	// Find all ranges that could overlap
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		if entry.Range.Start >= r.End {
			// No more overlapping ranges possible
			break
		}
		if entry.Range.Overlaps(r) {
			results = append(results, entry)
		}
	}
	
	return results
}

// GetInRange returns all entries completely contained within the given range.
func (m *RangeMap[T]) GetInRange(r Range) []Entry[T] {
	if r.IsEmpty() {
		return nil
	}

	var results []Entry[T]
	
	// We need to iterate through all entries to find those completely within the range
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		// Stop if we've passed the end of the query range
		if entry.Range.Start >= r.End {
			break
		}
		// Check if the entry is completely contained within the query range
		if entry.Range.Start >= r.Start && entry.Range.End <= r.End {
			results = append(results, entry)
		}
	}
	
	return results
}

// Coalesce merges adjacent or overlapping ranges with the same value.
// The merge function is called to combine values when ranges are merged.
// If merge is nil, the value from the first range is kept.
func (m *RangeMap[T]) Coalesce(equals func(a, b T) bool, merge func(a, b T) T) {
	if m.tree.Len() == 0 {
		return
	}

	var newEntries []Entry[T]
	var current *Entry[T]
	
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		
		if current == nil {
			// First entry
			e := entry
			current = &e
			continue
		}
		
		// Check if we can merge with current
		canMerge := current.Range.End >= entry.Range.Start &&
			(equals == nil || equals(current.Value, entry.Value))
		
		if canMerge {
			// Extend current range
			if entry.Range.End > current.Range.End {
				current.Range.End = entry.Range.End
			}
			if merge != nil {
				current.Value = merge(current.Value, entry.Value)
			}
		} else {
			// Save current and start new
			newEntries = append(newEntries, *current)
			e := entry
			current = &e
		}
	}
	
	// Don't forget the last entry
	if current != nil {
		newEntries = append(newEntries, *current)
	}
	
	// Rebuild tree with coalesced entries
	m.tree.Clear()
	for _, entry := range newEntries {
		m.tree.Insert(entry)
	}
}

// Clear removes all entries from the map.
func (m *RangeMap[T]) Clear() {
	m.tree.Clear()
}

// Len returns the number of ranges in the map.
func (m *RangeMap[T]) Len() int {
	return m.tree.Len()
}

// IsEmpty returns true if the map contains no ranges.
func (m *RangeMap[T]) IsEmpty() bool {
	return m.tree.Len() == 0
}

// Shift adjusts all ranges by the given offset.
// This is useful when text is inserted or deleted.
func (m *RangeMap[T]) Shift(offset int, afterPos int) {
	if offset == 0 {
		return
	}

	var entries []Entry[T]
	
	// Collect all entries
	iter := m.tree.Iterator()
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		entry := iter.Item().(Entry[T])
		entries = append(entries, entry)
	}
	
	// Clear and rebuild with shifted positions
	m.tree.Clear()
	for _, entry := range entries {
		// Adjust range based on position
		if entry.Range.Start >= afterPos {
			entry.Range.Start += offset
			entry.Range.End += offset
		} else if entry.Range.End > afterPos {
			// Range spans the shift position
			entry.Range.End += offset
			if entry.Range.End < entry.Range.Start {
				// Range was deleted
				continue
			}
		}
		m.tree.Insert(entry)
	}
}

// Iterator returns an iterator for traversing ranges in order.
func (m *RangeMap[T]) Iterator() *Iterator[T] {
	return &Iterator[T]{
		btreeIter: m.tree.Iterator(),
	}
}

// Iterator provides ordered traversal of range entries.
type Iterator[T any] struct {
	btreeIter *btree.Iterator
}

// Valid returns true if the iterator is positioned at a valid entry.
func (it *Iterator[T]) Valid() bool {
	return it.btreeIter.Valid()
}

// Entry returns the current entry.
func (it *Iterator[T]) Entry() Entry[T] {
	return it.btreeIter.Item().(Entry[T])
}

// Next advances to the next entry.
func (it *Iterator[T]) Next() bool {
	return it.btreeIter.Next()
}

// Prev moves to the previous entry.
func (it *Iterator[T]) Prev() bool {
	return it.btreeIter.Prev()
}

// SeekFirst positions at the first entry.
func (it *Iterator[T]) SeekFirst() bool {
	return it.btreeIter.SeekFirst()
}

// SeekLast positions at the last entry.
func (it *Iterator[T]) SeekLast() bool {
	return it.btreeIter.SeekLast()
}

// Seek positions at the first entry with start >= pos.
func (it *Iterator[T]) Seek(pos int) bool {
	return it.btreeIter.Seek(Entry[T]{Range: Range{Start: pos, End: pos}})
}