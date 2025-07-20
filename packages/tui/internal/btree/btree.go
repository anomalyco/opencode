// Package btree implements a generic B-tree data structure optimized for cache locality
// and range queries. This implementation is designed for high-performance text editing
// and metadata management in TUI components.
package btree

import (
	"fmt"
	"strings"
)

// DefaultDegree is the default minimum degree for B-tree nodes.
// A higher degree means fewer levels but larger nodes.
const DefaultDegree = 32

// Item represents an item that can be stored in the B-tree.
// Items must be comparable for ordering.
type Item interface {
	// Less returns true if this item is less than the other item.
	Less(other Item) bool
}

// RangeItem extends Item with range query support.
type RangeItem interface {
	Item
	// Contains returns true if this item's range contains the given point.
	Contains(point Item) bool
	// Overlaps returns true if this item's range overlaps with the other range.
	Overlaps(other RangeItem) bool
}

// node represents a node in the B-tree.
type node struct {
	items    []Item
	children []*node
	leaf     bool
}

// BTree is a B-tree implementation with configurable degree.
type BTree struct {
	root   *node
	degree int // minimum degree (t)
	length int // total number of items
}

// New creates a new B-tree with the default degree.
func New() *BTree {
	return NewWithDegree(DefaultDegree)
}

// NewWithDegree creates a new B-tree with the specified minimum degree.
// The degree must be at least 2.
func NewWithDegree(degree int) *BTree {
	if degree < 2 {
		degree = 2
	}
	return &BTree{
		root:   &node{leaf: true},
		degree: degree,
	}
}

// Len returns the number of items in the tree.
func (t *BTree) Len() int {
	return t.length
}

// Insert adds an item to the tree.
// If an item with the same key exists, it will be replaced.
func (t *BTree) Insert(item Item) {
	if t.root.isFull(t.degree) {
		// Split root
		oldRoot := t.root
		t.root = &node{
			children: []*node{oldRoot},
			leaf:     false,
		}
		t.root.splitChild(0, t.degree)
	}
	
	replaced := t.root.insert(item, t.degree)
	if !replaced {
		t.length++
	}
}

// Delete removes an item from the tree.
// Returns true if the item was found and deleted.
func (t *BTree) Delete(item Item) bool {
	deleted := t.root.delete(item, t.degree)
	if deleted {
		t.length--
		// If root is empty and has children, promote the only child
		if len(t.root.items) == 0 && !t.root.leaf {
			t.root = t.root.children[0]
		}
	}
	return deleted
}

// Get searches for an item in the tree.
// Returns the item and true if found, nil and false otherwise.
func (t *BTree) Get(key Item) (Item, bool) {
	return t.root.get(key)
}

// RangeQuery returns all items within the given range [min, max].
func (t *BTree) RangeQuery(min, max Item) []Item {
	var result []Item
	t.root.rangeQuery(min, max, &result)
	return result
}

// Min returns the minimum item in the tree.
func (t *BTree) Min() (Item, bool) {
	if t.length == 0 {
		return nil, false
	}
	return t.root.min(), true
}

// Max returns the maximum item in the tree.
func (t *BTree) Max() (Item, bool) {
	if t.length == 0 {
		return nil, false
	}
	return t.root.max(), true
}

// Clear removes all items from the tree.
func (t *BTree) Clear() {
	t.root = &node{leaf: true}
	t.length = 0
}

// Iterator returns an iterator for traversing the tree in order.
func (t *BTree) Iterator() *Iterator {
	iter := &Iterator{
		tree:  t,
		stack: make([]*iteratorState, 0, 32),
	}
	iter.seekStart()
	return iter
}

// Verify checks the B-tree invariants and returns an error if any are violated.
// This is useful for testing and debugging.
func (t *BTree) Verify() error {
	if t.root == nil {
		return fmt.Errorf("nil root")
	}
	
	// Check all invariants
	_, _, err := t.root.verify(t.degree, nil, nil)
	return err
}

// String returns a string representation of the tree for debugging.
func (t *BTree) String() string {
	var sb strings.Builder
	t.root.writeString(&sb, "", true)
	return sb.String()
}

// Node methods

// isFull returns true if the node has the maximum number of items (2t-1).
func (n *node) isFull(degree int) bool {
	return len(n.items) >= 2*degree-1
}

// insert adds an item to the subtree rooted at this node.
// Returns true if an existing item was replaced.
func (n *node) insert(item Item, degree int) bool {
	i := n.search(item)
	
	// Check if item already exists
	if i < len(n.items) && !item.Less(n.items[i]) && !n.items[i].Less(item) {
		n.items[i] = item
		return true
	}
	
	if n.leaf {
		// Insert into leaf node
		n.items = append(n.items, nil)
		copy(n.items[i+1:], n.items[i:])
		n.items[i] = item
		return false
	}
	
	// Insert into appropriate child
	if n.children[i].isFull(degree) {
		n.splitChild(i, degree)
		// Recompute insertion index after split
		if item.Less(n.items[i]) {
			// Stay with left child
		} else if n.items[i].Less(item) {
			i++ // Move to right child
		} else {
			// Item equals the promoted key
			n.items[i] = item
			return true
		}
	}
	
	return n.children[i].insert(item, degree)
}

// splitChild splits the i-th child of this node.
func (n *node) splitChild(i int, degree int) {
	fullChild := n.children[i]
	newChild := &node{
		leaf:  fullChild.leaf,
		items: make([]Item, degree-1),
	}
	
	// Copy right half of items to new child
	copy(newChild.items, fullChild.items[degree:])
	
	// Copy right half of children if not a leaf
	if !fullChild.leaf {
		newChild.children = make([]*node, degree)
		copy(newChild.children, fullChild.children[degree:])
		fullChild.children = fullChild.children[:degree]
	}
	
	// Promote middle item
	promotedItem := fullChild.items[degree-1]
	fullChild.items = fullChild.items[:degree-1]
	
	// Insert promoted item and new child into parent
	n.items = append(n.items, nil)
	copy(n.items[i+1:], n.items[i:])
	n.items[i] = promotedItem
	
	n.children = append(n.children, nil)
	copy(n.children[i+2:], n.children[i+1:])
	n.children[i+1] = newChild
}

// delete removes an item from the subtree rooted at this node.
func (n *node) delete(item Item, degree int) bool {
	i := n.search(item)
	
	if i < len(n.items) && !item.Less(n.items[i]) && !n.items[i].Less(item) {
		// Found item in this node
		if n.leaf {
			// Delete from leaf
			n.items = append(n.items[:i], n.items[i+1:]...)
			return true
		}
		
		// Delete from internal node
		return n.deleteFromNonLeaf(i, degree)
	}
	
	if n.leaf {
		// Item not found
		return false
	}
	
	// Delete from subtree
	shouldFix := len(n.children[i].items) == degree-1
	
	if shouldFix {
		// Ensure child has at least t items before descending
		n.fixChild(i, degree)
		// Recompute index after potential merge
		i = n.search(item)
		if i < len(n.items) && !item.Less(n.items[i]) && !n.items[i].Less(item) {
			// Item moved to this node during merge
			if n.leaf {
				n.items = append(n.items[:i], n.items[i+1:]...)
				return true
			}
			return n.deleteFromNonLeaf(i, degree)
		}
	}
	
	// Descend to appropriate child
	childIndex := i
	if childIndex > len(n.children)-1 {
		childIndex = len(n.children) - 1
	}
	return n.children[childIndex].delete(item, degree)
}

// deleteFromNonLeaf handles deletion of an item at index i from an internal node.
func (n *node) deleteFromNonLeaf(i int, degree int) bool {
	item := n.items[i]
	
	if len(n.children[i].items) >= degree {
		// Get predecessor from left subtree
		pred := n.children[i].max()
		n.items[i] = pred
		return n.children[i].delete(pred, degree)
	}
	
	if len(n.children[i+1].items) >= degree {
		// Get successor from right subtree
		succ := n.children[i+1].min()
		n.items[i] = succ
		return n.children[i+1].delete(succ, degree)
	}
	
	// Both children have minimum items, merge
	n.merge(i, degree)
	return n.children[i].delete(item, degree)
}

// fixChild ensures that the i-th child has at least t items.
func (n *node) fixChild(i int, degree int) {
	// Try to borrow from left sibling
	if i > 0 && len(n.children[i-1].items) >= degree {
		n.borrowFromLeft(i)
		return
	}
	
	// Try to borrow from right sibling
	if i < len(n.children)-1 && len(n.children[i+1].items) >= degree {
		n.borrowFromRight(i)
		return
	}
	
	// Merge with a sibling
	if i < len(n.children)-1 {
		n.merge(i, degree)
	} else {
		n.merge(i-1, degree)
	}
}

// borrowFromLeft moves an item from the left sibling through the parent.
func (n *node) borrowFromLeft(childIndex int) {
	child := n.children[childIndex]
	leftSibling := n.children[childIndex-1]
	
	// Move item from parent to child
	child.items = append([]Item{n.items[childIndex-1]}, child.items...)
	
	// Move item from left sibling to parent
	n.items[childIndex-1] = leftSibling.items[len(leftSibling.items)-1]
	leftSibling.items = leftSibling.items[:len(leftSibling.items)-1]
	
	// Move child pointer if not leaf
	if !child.leaf {
		child.children = append([]*node{leftSibling.children[len(leftSibling.children)-1]}, child.children...)
		leftSibling.children = leftSibling.children[:len(leftSibling.children)-1]
	}
}

// borrowFromRight moves an item from the right sibling through the parent.
func (n *node) borrowFromRight(childIndex int) {
	child := n.children[childIndex]
	rightSibling := n.children[childIndex+1]
	
	// Move item from parent to child
	child.items = append(child.items, n.items[childIndex])
	
	// Move item from right sibling to parent
	n.items[childIndex] = rightSibling.items[0]
	rightSibling.items = rightSibling.items[1:]
	
	// Move child pointer if not leaf
	if !child.leaf {
		child.children = append(child.children, rightSibling.children[0])
		rightSibling.children = rightSibling.children[1:]
	}
}

// merge combines the i-th child with its right sibling.
func (n *node) merge(i int, degree int) {
	child := n.children[i]
	rightSibling := n.children[i+1]
	
	// Pull item from parent and merge with right sibling
	child.items = append(child.items, n.items[i])
	child.items = append(child.items, rightSibling.items...)
	
	// Copy child pointers if not leaf
	if !child.leaf {
		child.children = append(child.children, rightSibling.children...)
	}
	
	// Remove item from parent
	n.items = append(n.items[:i], n.items[i+1:]...)
	
	// Remove right sibling
	n.children = append(n.children[:i+1], n.children[i+2:]...)
}

// search returns the index where item should be inserted.
func (n *node) search(item Item) int {
	// Binary search for the first item greater than the search item
	low, high := 0, len(n.items)
	for low < high {
		mid := (low + high) / 2
		if item.Less(n.items[mid]) {
			high = mid
		} else {
			low = mid + 1
		}
	}
	// Adjust to point to equal item if exists
	if low > 0 && low <= len(n.items) && !n.items[low-1].Less(item) && !item.Less(n.items[low-1]) {
		return low - 1
	}
	return low
}

// get searches for an item in the subtree.
func (n *node) get(key Item) (Item, bool) {
	i := n.search(key)
	
	if i < len(n.items) && !key.Less(n.items[i]) && !n.items[i].Less(key) {
		return n.items[i], true
	}
	
	if n.leaf {
		return nil, false
	}
	
	return n.children[i].get(key)
}

// rangeQuery adds all items in [min, max] to the result slice.
func (n *node) rangeQuery(min, max Item, result *[]Item) {
	// Find starting position
	i := 0
	for i < len(n.items) && n.items[i].Less(min) {
		i++
	}
	
	// Traverse items and children in range
	for i <= len(n.items) {
		// Check left child
		if !n.leaf && i < len(n.children) {
			n.children[i].rangeQuery(min, max, result)
		}
		
		// Check item
		if i < len(n.items) {
			if max.Less(n.items[i]) {
				// Passed the range
				return
			}
			if !n.items[i].Less(min) {
				*result = append(*result, n.items[i])
			}
		}
		
		i++
	}
}

// min returns the minimum item in the subtree.
func (n *node) min() Item {
	for !n.leaf {
		n = n.children[0]
	}
	return n.items[0]
}

// max returns the maximum item in the subtree.
func (n *node) max() Item {
	for !n.leaf {
		n = n.children[len(n.children)-1]
	}
	return n.items[len(n.items)-1]
}

// verify checks B-tree invariants for the subtree.
func (n *node) verify(degree int, min, max Item) (int, int, error) {
	// Check item order
	for i := 1; i < len(n.items); i++ {
		if !n.items[i-1].Less(n.items[i]) {
			return 0, 0, fmt.Errorf("items not in order")
		}
	}
	
	// Check bounds
	if min != nil && len(n.items) > 0 && n.items[0].Less(min) {
		return 0, 0, fmt.Errorf("item less than min bound")
	}
	if max != nil && len(n.items) > 0 && max.Less(n.items[len(n.items)-1]) {
		return 0, 0, fmt.Errorf("item greater than max bound")
	}
	
	// Check node constraints
	if n != nil && len(n.items) > 2*degree-1 {
		return 0, 0, fmt.Errorf("too many items: %d > %d", len(n.items), 2*degree-1)
	}
	
	if n.leaf {
		// Leaf node
		if !n.leaf && len(n.children) != len(n.items)+1 {
			return 0, 0, fmt.Errorf("leaf has children")
		}
		return 1, len(n.items), nil
	}
	
	// Internal node
	if len(n.children) != len(n.items)+1 {
		return 0, 0, fmt.Errorf("wrong number of children: %d != %d", len(n.children), len(n.items)+1)
	}
	
	// Check children
	height := -1
	totalItems := len(n.items)
	
	for i, child := range n.children {
		var childMin, childMax Item
		if i > 0 {
			childMin = n.items[i-1]
		} else {
			childMin = min
		}
		if i < len(n.items) {
			childMax = n.items[i]
		} else {
			childMax = max
		}
		
		h, items, err := child.verify(degree, childMin, childMax)
		if err != nil {
			return 0, 0, err
		}
		
		if height == -1 {
			height = h
		} else if height != h {
			return 0, 0, fmt.Errorf("unbalanced tree")
		}
		
		totalItems += items
		
		// Check minimum items (except root)
		if child != nil && len(child.items) < degree-1 {
			return 0, 0, fmt.Errorf("too few items in child: %d < %d", len(child.items), degree-1)
		}
	}
	
	return height + 1, totalItems, nil
}

// writeString writes a string representation of the subtree.
func (n *node) writeString(sb *strings.Builder, prefix string, isLast bool) {
	sb.WriteString(prefix)
	if isLast {
		sb.WriteString("└── ")
		prefix += "    "
	} else {
		sb.WriteString("├── ")
		prefix += "│   "
	}
	
	// Write items
	sb.WriteString("[")
	for i, item := range n.items {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString(fmt.Sprintf("%v", item))
	}
	sb.WriteString("]")
	if n.leaf {
		sb.WriteString(" (leaf)")
	}
	sb.WriteString("\n")
	
	// Write children
	for i, child := range n.children {
		child.writeString(sb, prefix, i == len(n.children)-1)
	}
}