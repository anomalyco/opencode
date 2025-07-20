package btree

// iteratorState tracks the current position in a node during iteration.
type iteratorState struct {
	node  *node
	index int
}

// Iterator provides ordered traversal of B-tree items.
type Iterator struct {
	tree    *BTree
	stack   []*iteratorState
	current Item
	valid   bool
}

// Valid returns true if the iterator is positioned at a valid item.
func (it *Iterator) Valid() bool {
	return it.valid
}

// Item returns the current item. Only valid if Valid() returns true.
func (it *Iterator) Item() Item {
	return it.current
}

// Next advances the iterator to the next item.
// Returns false if there are no more items.
func (it *Iterator) Next() bool {
	if len(it.stack) == 0 {
		it.valid = false
		return false
	}
	
	// Get current position
	state := it.stack[len(it.stack)-1]
	
	// If we have a right child, go to its minimum
	if !state.node.leaf && state.index < len(state.node.children)-1 {
		// Move to right child
		state.index++
		it.pushLeftmost(state.node.children[state.index])
		
		// Current item is at top of stack
		if len(it.stack) > 0 {
			top := it.stack[len(it.stack)-1]
			if len(top.node.items) > 0 {
				it.current = top.node.items[0]
				it.valid = true
				return true
			}
		}
	}
	
	// Move to next item in current node
	state.index++
	
	// Find next valid position
	for len(it.stack) > 0 {
		state = it.stack[len(it.stack)-1]
		
		if state.index < len(state.node.items) {
			// Found next item
			it.current = state.node.items[state.index]
			it.valid = true
			return true
		}
		
		// No more items in this node, pop and continue
		it.stack = it.stack[:len(it.stack)-1]
		
		if len(it.stack) > 0 {
			// Continue from parent
			state = it.stack[len(it.stack)-1]
		}
	}
	
	it.valid = false
	return false
}

// Prev moves the iterator to the previous item.
// Returns false if there are no more items.
func (it *Iterator) Prev() bool {
	if len(it.stack) == 0 {
		it.valid = false
		return false
	}
	
	// Get current position
	state := it.stack[len(it.stack)-1]
	
	// If we have a left child at current index, go to its maximum
	if !state.node.leaf && state.index >= 0 && state.index < len(state.node.children) {
		it.pushRightmost(state.node.children[state.index])
		
		// Current item is at top of stack
		if len(it.stack) > 0 {
			top := it.stack[len(it.stack)-1]
			if len(top.node.items) > 0 {
				it.current = top.node.items[len(top.node.items)-1]
				top.index = len(top.node.items) - 1
				it.valid = true
				return true
			}
		}
	}
	
	// Move to previous item in current node
	state.index--
	
	// Find previous valid position
	for len(it.stack) > 0 {
		state = it.stack[len(it.stack)-1]
		
		if state.index >= 0 && state.index < len(state.node.items) {
			// Found previous item
			it.current = state.node.items[state.index]
			it.valid = true
			return true
		}
		
		// No more items in this node, pop and continue
		it.stack = it.stack[:len(it.stack)-1]
		
		if len(it.stack) > 0 {
			// Continue from parent
			state = it.stack[len(it.stack)-1]
			state.index--
		}
	}
	
	it.valid = false
	return false
}

// Seek positions the iterator at the smallest item greater than or equal to key.
func (it *Iterator) Seek(key Item) bool {
	it.stack = it.stack[:0]
	it.valid = false
	
	if it.tree.root == nil {
		return false
	}
	
	// Find the path to the key
	node := it.tree.root
	for {
		i := node.search(key)
		
		// Add current position to stack
		it.stack = append(it.stack, &iteratorState{
			node:  node,
			index: i,
		})
		
		// Check if we found exact match
		if i < len(node.items) && !key.Less(node.items[i]) && !node.items[i].Less(key) {
			it.current = node.items[i]
			it.valid = true
			return true
		}
		
		// If leaf, position at insertion point
		if node.leaf {
			if i < len(node.items) {
				it.current = node.items[i]
				it.valid = true
				return true
			}
			// No items >= key, try next
			return it.Next()
		}
		
		// Continue to child
		node = node.children[i]
	}
}

// SeekFirst positions the iterator at the first item.
func (it *Iterator) SeekFirst() bool {
	it.seekStart()
	if len(it.stack) > 0 && len(it.stack[len(it.stack)-1].node.items) > 0 {
		it.current = it.stack[len(it.stack)-1].node.items[0]
		it.valid = true
		return true
	}
	it.valid = false
	return false
}

// SeekLast positions the iterator at the last item.
func (it *Iterator) SeekLast() bool {
	it.seekEnd()
	if len(it.stack) > 0 {
		state := it.stack[len(it.stack)-1]
		if len(state.node.items) > 0 {
			state.index = len(state.node.items) - 1
			it.current = state.node.items[state.index]
			it.valid = true
			return true
		}
	}
	it.valid = false
	return false
}

// seekStart positions the stack at the leftmost leaf.
func (it *Iterator) seekStart() {
	it.stack = it.stack[:0]
	it.valid = false
	
	if it.tree.root == nil {
		return
	}
	
	it.pushLeftmost(it.tree.root)
}

// seekEnd positions the stack at the rightmost leaf.
func (it *Iterator) seekEnd() {
	it.stack = it.stack[:0]
	it.valid = false
	
	if it.tree.root == nil {
		return
	}
	
	it.pushRightmost(it.tree.root)
}

// pushLeftmost pushes nodes onto the stack down to the leftmost leaf.
func (it *Iterator) pushLeftmost(node *node) {
	for node != nil {
		it.stack = append(it.stack, &iteratorState{
			node:  node,
			index: 0,
		})
		
		if node.leaf {
			break
		}
		
		if len(node.children) > 0 {
			node = node.children[0]
		} else {
			break
		}
	}
}

// pushRightmost pushes nodes onto the stack down to the rightmost leaf.
func (it *Iterator) pushRightmost(node *node) {
	for node != nil {
		state := &iteratorState{
			node:  node,
			index: len(node.items),
		}
		it.stack = append(it.stack, state)
		
		if node.leaf {
			break
		}
		
		if len(node.children) > 0 {
			node = node.children[len(node.children)-1]
		} else {
			break
		}
	}
}