package app

import (
	"sync"
	"time"

	"github.com/sst/opencode-sdk-go"
)

// QueuedMessage represents a message waiting to be sent
type QueuedMessage struct {
	Content     string
	Attachments []opencode.FilePartParam
	QueuedAt    time.Time
}

// MessageQueue manages a single queued message per session
type MessageQueue struct {
	message *QueuedMessage
	mutex   sync.RWMutex
}

// NewMessageQueue creates a new empty message queue
func NewMessageQueue() *MessageQueue {
	return &MessageQueue{}
}

// Enqueue adds a message to the queue if it's empty
// Returns true if the message was queued, false if queue is full
func (q *MessageQueue) Enqueue(content string, attachments []opencode.FilePartParam) bool {
	q.mutex.Lock()
	defer q.mutex.Unlock()

	if q.message != nil {
		return false // Queue full
	}

	q.message = &QueuedMessage{
		Content:     content,
		Attachments: attachments,
		QueuedAt:    time.Now(),
	}
	return true
}

// Dequeue removes and returns the queued message
// Returns nil if queue is empty
func (q *MessageQueue) Dequeue() *QueuedMessage {
	q.mutex.Lock()
	defer q.mutex.Unlock()

	msg := q.message
	q.message = nil
	return msg
}

// Peek returns the queued message without removing it
// Returns nil if queue is empty
func (q *MessageQueue) Peek() *QueuedMessage {
	q.mutex.RLock()
	defer q.mutex.RUnlock()
	return q.message
}

// Update modifies the queued message content and attachments
// Returns true if update was successful, false if queue is empty
func (q *MessageQueue) Update(content string, attachments []opencode.FilePartParam) bool {
	q.mutex.Lock()
	defer q.mutex.Unlock()

	if q.message == nil {
		return false
	}

	q.message.Content = content
	q.message.Attachments = attachments
	return true
}

// Clear removes the queued message
func (q *MessageQueue) Clear() {
	q.mutex.Lock()
	defer q.mutex.Unlock()
	q.message = nil
}

// IsEmpty returns true if the queue has no messages
func (q *MessageQueue) IsEmpty() bool {
	q.mutex.RLock()
	defer q.mutex.RUnlock()
	return q.message == nil
}

// GetPreview returns a shortened version of the queued message content
func (q *MessageQueue) GetPreview(maxLength int) string {
	q.mutex.RLock()
	defer q.mutex.RUnlock()

	if q.message == nil {
		return ""
	}

	content := q.message.Content
	if len(content) <= maxLength {
		return content
	}

	return content[:maxLength-3] + "..."
}