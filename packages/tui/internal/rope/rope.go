// Package rope implements an immutable rope data structure for efficient
// string manipulation operations on large texts.
package rope

import (
	"fmt"
	"strings"
)

// Constants for rope balancing
const (
	// SplitLength is the maximum length of a leaf node
	SplitLength = 1024
	// JoinLength is the minimum length before joining nodes
	JoinLength = SplitLength / 2
)

// Rope represents an immutable rope data structure.
type Rope struct {
	root   node
	length int
	lines  int
}

// node is the internal representation of rope nodes.
type node interface {
	// length returns the total length of text in this node
	length() int
	// lines returns the number of newlines in this node
	lines() int
	// charAt returns the character at the given index
	charAt(index int) (rune, error)
	// substring returns a substring from start to end
	substring(start, end int) string
	// insert inserts text at the given offset
	insert(offset int, text string) node
	// delete removes count characters starting at offset
	delete(offset int, count int) node
	// split splits the node at the given offset
	split(offset int) (left, right node)
	// rebalance rebalances the node if needed
	rebalance() node
	// depth returns the depth of the tree
	depth() int
}

// leafNode represents a leaf containing actual text.
type leafNode struct {
	data []rune
}

// innerNode represents an internal node with two children.
type innerNode struct {
	left       node
	right      node
	leftLength int // Cached length of left subtree
	leftLines  int // Cached line count of left subtree
}

// New creates a new rope from the given string.
func New(s string) *Rope {
	if s == "" {
		return &Rope{
			root:   &leafNode{data: []rune{}},
			length: 0,
			lines:  0,
		}
	}
	
	runes := []rune(s)
	lines := countNewlines(runes)
	
	// Split into chunks if too large
	var nodes []node
	for i := 0; i < len(runes); i += SplitLength {
		end := i + SplitLength
		if end > len(runes) {
			end = len(runes)
		}
		nodes = append(nodes, &leafNode{data: runes[i:end]})
	}
	
	// Build tree from leaves
	root := buildTree(nodes)
	
	return &Rope{
		root:   root,
		length: len(runes),
		lines:  lines,
	}
}

// NewEmpty creates an empty rope.
func NewEmpty() *Rope {
	return New("")
}

// String returns the rope as a string.
func (r *Rope) String() string {
	if r.root == nil {
		return ""
	}
	return r.root.substring(0, r.length)
}

// Len returns the length of the rope in runes.
func (r *Rope) Len() int {
	return r.length
}

// Lines returns the number of lines in the rope.
func (r *Rope) Lines() int {
	return r.lines + 1 // Number of lines is newlines + 1
}

// CharAt returns the character at the given index.
func (r *Rope) CharAt(index int) (rune, error) {
	if index < 0 || index >= r.length {
		return 0, fmt.Errorf("index %d out of bounds [0, %d)", index, r.length)
	}
	return r.root.charAt(index)
}

// Substring returns a substring from start to end.
func (r *Rope) Substring(start, end int) string {
	if start < 0 {
		start = 0
	}
	if end > r.length {
		end = r.length
	}
	if start >= end {
		return ""
	}
	return r.root.substring(start, end)
}

// Insert creates a new rope with text inserted at the given position.
func (r *Rope) Insert(pos int, text string) *Rope {
	if pos < 0 {
		pos = 0
	}
	if pos > r.length {
		pos = r.length
	}
	
	if text == "" {
		return r
	}
	
	runes := []rune(text)
	newRoot := r.root.insert(pos, text).rebalance()
	
	return &Rope{
		root:   newRoot,
		length: r.length + len(runes),
		lines:  r.lines + countNewlines(runes),
	}
}

// Delete creates a new rope with characters deleted.
func (r *Rope) Delete(start, end int) *Rope {
	if start < 0 {
		start = 0
	}
	if end > r.length {
		end = r.length
	}
	if start >= end {
		return r
	}
	
	// Count newlines being deleted
	deleted := r.Substring(start, end)
	deletedLines := countNewlines([]rune(deleted))
	
	newRoot := r.root.delete(start, end-start).rebalance()
	
	return &Rope{
		root:   newRoot,
		length: r.length - (end - start),
		lines:  r.lines - deletedLines,
	}
}

// Split splits the rope at the given position.
func (r *Rope) Split(pos int) (*Rope, *Rope) {
	if pos <= 0 {
		return NewEmpty(), r
	}
	if pos >= r.length {
		return r, NewEmpty()
	}
	
	left, right := r.root.split(pos)
	
	leftStr := left.substring(0, left.length())
	rightStr := right.substring(0, right.length())
	
	return New(leftStr), New(rightStr)
}

// Concat concatenates two ropes.
func (r *Rope) Concat(other *Rope) *Rope {
	if r.length == 0 {
		return other
	}
	if other.length == 0 {
		return r
	}
	
	newRoot := &innerNode{
		left:       r.root,
		right:      other.root,
		leftLength: r.length,
		leftLines:  r.lines,
	}
	
	return &Rope{
		root:   newRoot.rebalance(),
		length: r.length + other.length,
		lines:  r.lines + other.lines,
	}
}

// leafNode implementation

func (n *leafNode) length() int {
	return len(n.data)
}

func (n *leafNode) lines() int {
	return countNewlines(n.data)
}

func (n *leafNode) charAt(index int) (rune, error) {
	if index < 0 || index >= len(n.data) {
		return 0, fmt.Errorf("index out of bounds")
	}
	return n.data[index], nil
}

func (n *leafNode) substring(start, end int) string {
	if start < 0 {
		start = 0
	}
	if end > len(n.data) {
		end = len(n.data)
	}
	if start >= end {
		return ""
	}
	return string(n.data[start:end])
}

func (n *leafNode) insert(offset int, text string) node {
	runes := []rune(text)
	newData := make([]rune, len(n.data)+len(runes))
	
	copy(newData, n.data[:offset])
	copy(newData[offset:], runes)
	copy(newData[offset+len(runes):], n.data[offset:])
	
	// Split if too large
	if len(newData) > SplitLength {
		mid := len(newData) / 2
		return &innerNode{
			left:       &leafNode{data: newData[:mid]},
			right:      &leafNode{data: newData[mid:]},
			leftLength: mid,
			leftLines:  countNewlines(newData[:mid]),
		}
	}
	
	return &leafNode{data: newData}
}

func (n *leafNode) delete(offset int, count int) node {
	if count <= 0 {
		return n
	}
	
	end := offset + count
	if end > len(n.data) {
		end = len(n.data)
	}
	
	newData := make([]rune, len(n.data)-(end-offset))
	copy(newData, n.data[:offset])
	copy(newData[offset:], n.data[end:])
	
	return &leafNode{data: newData}
}

func (n *leafNode) split(offset int) (left, right node) {
	return &leafNode{data: n.data[:offset]}, &leafNode{data: n.data[offset:]}
}

func (n *leafNode) rebalance() node {
	return n
}

func (n *leafNode) depth() int {
	return 0
}

// innerNode implementation

func (n *innerNode) length() int {
	return n.leftLength + n.right.length()
}

func (n *innerNode) lines() int {
	return n.leftLines + n.right.lines()
}

func (n *innerNode) charAt(index int) (rune, error) {
	if index < n.leftLength {
		return n.left.charAt(index)
	}
	return n.right.charAt(index - n.leftLength)
}

func (n *innerNode) substring(start, end int) string {
	if end <= n.leftLength {
		return n.left.substring(start, end)
	}
	if start >= n.leftLength {
		return n.right.substring(start-n.leftLength, end-n.leftLength)
	}
	
	// Spans both children
	var sb strings.Builder
	sb.WriteString(n.left.substring(start, n.leftLength))
	sb.WriteString(n.right.substring(0, end-n.leftLength))
	return sb.String()
}

func (n *innerNode) insert(offset int, text string) node {
	if offset <= n.leftLength {
		return &innerNode{
			left:       n.left.insert(offset, text),
			right:      n.right,
			leftLength: n.leftLength + len([]rune(text)),
			leftLines:  n.leftLines + countNewlines([]rune(text)),
		}
	}
	
	return &innerNode{
		left:       n.left,
		right:      n.right.insert(offset-n.leftLength, text),
		leftLength: n.leftLength,
		leftLines:  n.leftLines,
	}
}

func (n *innerNode) delete(offset int, count int) node {
	if count <= 0 {
		return n
	}
	
	end := offset + count
	
	// Deletion entirely in left child
	if end <= n.leftLength {
		deletedLines := countNewlines([]rune(n.left.substring(offset, end)))
		return &innerNode{
			left:       n.left.delete(offset, count),
			right:      n.right,
			leftLength: n.leftLength - count,
			leftLines:  n.leftLines - deletedLines,
		}
	}
	
	// Deletion entirely in right child
	if offset >= n.leftLength {
		return &innerNode{
			left:       n.left,
			right:      n.right.delete(offset-n.leftLength, count),
			leftLength: n.leftLength,
			leftLines:  n.leftLines,
		}
	}
	
	// Deletion spans both children
	leftDelete := n.leftLength - offset
	rightDelete := end - n.leftLength
	
	deletedLeftLines := countNewlines([]rune(n.left.substring(offset, n.leftLength)))
	
	return &innerNode{
		left:       n.left.delete(offset, leftDelete),
		right:      n.right.delete(0, rightDelete),
		leftLength: offset,
		leftLines:  n.leftLines - deletedLeftLines,
	}
}

func (n *innerNode) split(offset int) (left, right node) {
	if offset <= n.leftLength {
		ll, lr := n.left.split(offset)
		return ll, &innerNode{
			left:       lr,
			right:      n.right,
			leftLength: lr.length(),
			leftLines:  lr.lines(),
		}
	}
	
	rl, rr := n.right.split(offset - n.leftLength)
	return &innerNode{
		left:       n.left,
		right:      rl,
		leftLength: n.leftLength,
		leftLines:  n.leftLines,
	}, rr
}

func (n *innerNode) rebalance() node {
	// Check if we should merge small nodes
	totalLen := n.length()
	if totalLen < JoinLength {
		// Convert to leaf if small enough
		return &leafNode{data: []rune(n.substring(0, totalLen))}
	}
	
	// Check depth balance
	leftDepth := n.left.depth()
	rightDepth := n.right.depth()
	
	if abs(leftDepth-rightDepth) > 1 {
		// Rebalance by rebuilding
		text := n.substring(0, totalLen)
		return New(text).root
	}
	
	return n
}

func (n *innerNode) depth() int {
	leftDepth := n.left.depth()
	rightDepth := n.right.depth()
	if leftDepth > rightDepth {
		return leftDepth + 1
	}
	return rightDepth + 1
}

// Helper functions

func countNewlines(runes []rune) int {
	count := 0
	for _, r := range runes {
		if r == '\n' {
			count++
		}
	}
	return count
}

func buildTree(nodes []node) node {
	if len(nodes) == 0 {
		return &leafNode{data: []rune{}}
	}
	if len(nodes) == 1 {
		return nodes[0]
	}
	
	// Build tree bottom-up
	for len(nodes) > 1 {
		var newNodes []node
		for i := 0; i < len(nodes); i += 2 {
			if i+1 < len(nodes) {
				newNodes = append(newNodes, &innerNode{
					left:       nodes[i],
					right:      nodes[i+1],
					leftLength: nodes[i].length(),
					leftLines:  nodes[i].lines(),
				})
			} else {
				newNodes = append(newNodes, nodes[i])
			}
		}
		nodes = newNodes
	}
	
	return nodes[0]
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}