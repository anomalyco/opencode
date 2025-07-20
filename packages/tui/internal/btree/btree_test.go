package btree

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"
)

// intItem implements Item for testing with integers.
type intItem int

func (i intItem) Less(other Item) bool {
	return i < other.(intItem)
}

// rangeItem implements RangeItem for testing range queries.
type rangeItem struct {
	start, end int
}

func (r rangeItem) Less(other Item) bool {
	return r.start < other.(rangeItem).start
}

func (r rangeItem) Contains(point Item) bool {
	p := point.(intItem)
	return int(p) >= r.start && int(p) <= r.end
}

func (r rangeItem) Overlaps(other RangeItem) bool {
	o := other.(rangeItem)
	return r.start <= o.end && o.start <= r.end
}

func TestBTreeBasicOperations(t *testing.T) {
	tree := NewWithDegree(3)
	
	// Test empty tree
	if tree.Len() != 0 {
		t.Errorf("Empty tree should have length 0, got %d", tree.Len())
	}
	
	// Test insertion
	items := []int{3, 7, 1, 4, 9, 2, 6, 5, 8}
	for _, v := range items {
		tree.Insert(intItem(v))
	}
	
	if tree.Len() != len(items) {
		t.Errorf("Tree should have %d items, got %d", len(items), tree.Len())
	}
	
	// Verify tree structure
	if err := tree.Verify(); err != nil {
		t.Errorf("Tree verification failed: %v", err)
	}
	
	// Test retrieval
	for _, v := range items {
		item, found := tree.Get(intItem(v))
		if !found {
			t.Errorf("Item %d not found", v)
		}
		if item.(intItem) != intItem(v) {
			t.Errorf("Retrieved item %v != %d", item, v)
		}
	}
	
	// Test non-existent item
	_, found := tree.Get(intItem(100))
	if found {
		t.Error("Non-existent item should not be found")
	}
}

func TestBTreeDeletion(t *testing.T) {
	tree := NewWithDegree(3)
	
	// Insert items
	n := 20
	for i := 1; i <= n; i++ {
		tree.Insert(intItem(i))
	}
	
	// Delete even numbers
	for i := 2; i <= n; i += 2 {
		if !tree.Delete(intItem(i)) {
			t.Errorf("Failed to delete item %d", i)
		}
		
		// Verify after each deletion
		if err := tree.Verify(); err != nil {
			t.Errorf("Tree verification failed after deleting %d: %v", i, err)
		}
	}
	
	// Check remaining items
	if tree.Len() != n/2 {
		t.Errorf("Tree should have %d items, got %d", n/2, tree.Len())
	}
	
	// Verify odd numbers remain
	for i := 1; i <= n; i += 2 {
		_, found := tree.Get(intItem(i))
		if !found {
			t.Errorf("Item %d should exist", i)
		}
	}
	
	// Verify even numbers are gone
	for i := 2; i <= n; i += 2 {
		_, found := tree.Get(intItem(i))
		if found {
			t.Errorf("Item %d should not exist", i)
		}
	}
}

func TestBTreeRangeQuery(t *testing.T) {
	tree := NewWithDegree(4)
	
	// Insert items
	for i := 1; i <= 100; i++ {
		tree.Insert(intItem(i))
	}
	
	// Test range query
	min, max := intItem(25), intItem(35)
	results := tree.RangeQuery(min, max)
	
	// Verify results
	if len(results) != 11 {
		t.Errorf("Range query should return 11 items, got %d", len(results))
	}
	
	for i, item := range results {
		expected := intItem(25 + i)
		if item.(intItem) != expected {
			t.Errorf("Range query item %d: got %v, want %v", i, item, expected)
		}
	}
}

func TestBTreeMinMax(t *testing.T) {
	tree := New()
	
	// Test empty tree
	_, found := tree.Min()
	if found {
		t.Error("Empty tree should not have min")
	}
	
	_, found = tree.Max()
	if found {
		t.Error("Empty tree should not have max")
	}
	
	// Insert items
	items := []int{5, 3, 7, 1, 9, 2, 8, 4, 6}
	for _, v := range items {
		tree.Insert(intItem(v))
	}
	
	// Test min
	min, found := tree.Min()
	if !found || min.(intItem) != 1 {
		t.Errorf("Min should be 1, got %v", min)
	}
	
	// Test max
	max, found := tree.Max()
	if !found || max.(intItem) != 9 {
		t.Errorf("Max should be 9, got %v", max)
	}
}

func TestBTreeIterator(t *testing.T) {
	tree := NewWithDegree(3)
	
	// Insert items
	items := []int{5, 3, 7, 1, 9, 2, 8, 4, 6}
	for _, v := range items {
		tree.Insert(intItem(v))
	}
	
	// Test forward iteration
	iter := tree.Iterator()
	var collected []int
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		collected = append(collected, int(iter.Item().(intItem)))
	}
	
	// Verify order
	if len(collected) != len(items) {
		t.Errorf("Iterator returned %d items, want %d", len(collected), len(items))
	}
	
	for i := 1; i < len(collected); i++ {
		if collected[i-1] >= collected[i] {
			t.Errorf("Iterator items not in order: %v", collected)
			break
		}
	}
	
	// Test backward iteration
	collected = collected[:0]
	for iter.SeekLast(); iter.Valid(); iter.Prev() {
		collected = append(collected, int(iter.Item().(intItem)))
	}
	
	// Verify reverse order
	for i := 1; i < len(collected); i++ {
		if collected[i-1] <= collected[i] {
			t.Errorf("Reverse iterator items not in order: %v", collected)
			break
		}
	}
	
	// Test seek
	if !iter.Seek(intItem(5)) {
		t.Error("Seek to 5 should succeed")
	}
	if iter.Item().(intItem) != 5 {
		t.Errorf("Seek to 5 got %v", iter.Item())
	}
	
	// Test seek past max
	if iter.Seek(intItem(10)) {
		t.Error("Seek past max should return false")
	}
}

func TestBTreeStress(t *testing.T) {
	tree := NewWithDegree(32)
	n := 10000
	items := make([]int, n)
	
	// Generate random items
	for i := range items {
		items[i] = i
	}
	rand.Shuffle(len(items), func(i, j int) {
		items[i], items[j] = items[j], items[i]
	})
	
	// Insert all items
	for _, v := range items {
		tree.Insert(intItem(v))
	}
	
	if tree.Len() != n {
		t.Errorf("Tree should have %d items, got %d", n, tree.Len())
	}
	
	// Verify tree structure
	if err := tree.Verify(); err != nil {
		t.Errorf("Tree verification failed: %v", err)
	}
	
	// Delete half the items randomly
	toDelete := items[:n/2]
	rand.Shuffle(len(toDelete), func(i, j int) {
		toDelete[i], toDelete[j] = toDelete[j], toDelete[i]
	})
	
	for _, v := range toDelete {
		if !tree.Delete(intItem(v)) {
			t.Errorf("Failed to delete item %d", v)
		}
	}
	
	if tree.Len() != n/2 {
		t.Errorf("Tree should have %d items after deletion, got %d", n/2, tree.Len())
	}
	
	// Verify tree structure
	if err := tree.Verify(); err != nil {
		t.Errorf("Tree verification failed after deletions: %v", err)
	}
	
	// Verify remaining items
	remaining := items[n/2:]
	sort.Ints(remaining)
	
	iter := tree.Iterator()
	i := 0
	for iter.SeekFirst(); iter.Valid(); iter.Next() {
		if i >= len(remaining) {
			t.Error("Iterator returned too many items")
			break
		}
		if int(iter.Item().(intItem)) != remaining[i] {
			t.Errorf("Iterator item %d: got %v, want %d", i, iter.Item(), remaining[i])
		}
		i++
	}
	
	if i != len(remaining) {
		t.Errorf("Iterator returned %d items, want %d", i, len(remaining))
	}
}

func TestBTreeDuplicateHandling(t *testing.T) {
	tree := New()
	
	// Insert item
	tree.Insert(intItem(5))
	if tree.Len() != 1 {
		t.Errorf("Tree should have 1 item, got %d", tree.Len())
	}
	
	// Insert duplicate
	tree.Insert(intItem(5))
	if tree.Len() != 1 {
		t.Errorf("Tree should still have 1 item after duplicate insert, got %d", tree.Len())
	}
	
	// Verify item exists
	item, found := tree.Get(intItem(5))
	if !found || item.(intItem) != 5 {
		t.Errorf("Item 5 should exist")
	}
}

func TestBTreeClear(t *testing.T) {
	tree := New()
	
	// Insert items
	for i := 0; i < 100; i++ {
		tree.Insert(intItem(i))
	}
	
	// Clear tree
	tree.Clear()
	
	if tree.Len() != 0 {
		t.Errorf("Cleared tree should have 0 items, got %d", tree.Len())
	}
	
	// Verify empty
	_, found := tree.Get(intItem(50))
	if found {
		t.Error("Cleared tree should not contain any items")
	}
}

// Benchmarks

func BenchmarkBTreeInsert(b *testing.B) {
	for _, degree := range []int{16, 32, 64, 128} {
		b.Run(fmt.Sprintf("degree-%d", degree), func(b *testing.B) {
			tree := NewWithDegree(degree)
			b.ResetTimer()
			
			for i := 0; i < b.N; i++ {
				tree.Insert(intItem(i))
			}
		})
	}
}

func BenchmarkBTreeGet(b *testing.B) {
	tree := NewWithDegree(32)
	n := 100000
	
	// Pre-populate tree
	for i := 0; i < n; i++ {
		tree.Insert(intItem(i))
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tree.Get(intItem(i % n))
	}
}

func BenchmarkBTreeDelete(b *testing.B) {
	for _, n := range []int{1000, 10000, 100000} {
		b.Run(fmt.Sprintf("n-%d", n), func(b *testing.B) {
			b.StopTimer()
			tree := NewWithDegree(32)
			
			// Pre-populate
			for i := 0; i < n; i++ {
				tree.Insert(intItem(i))
			}
			
			b.StartTimer()
			for i := 0; i < b.N && i < n; i++ {
				tree.Delete(intItem(i))
			}
		})
	}
}

func BenchmarkBTreeRangeQuery(b *testing.B) {
	tree := NewWithDegree(32)
	n := 100000
	
	// Pre-populate
	for i := 0; i < n; i++ {
		tree.Insert(intItem(i))
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		start := i % (n - 100)
		tree.RangeQuery(intItem(start), intItem(start+100))
	}
}

func BenchmarkBTreeIterator(b *testing.B) {
	tree := NewWithDegree(32)
	n := 10000
	
	// Pre-populate
	for i := 0; i < n; i++ {
		tree.Insert(intItem(i))
	}
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		iter := tree.Iterator()
		count := 0
		for iter.SeekFirst(); iter.Valid() && count < 100; iter.Next() {
			_ = iter.Item()
			count++
		}
	}
}