package util

import (
	"fmt"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea/v2"
)

// InputBuffer provides non-blocking input handling during long operations
type InputBuffer struct {
	buffer     []tea.KeyPressMsg
	mutex      sync.RWMutex
	maxSize    int
	isBlocked  bool
	flushChan  chan []tea.KeyPressMsg
	blockChan  chan bool
	errorHandler func(error)
}

// NewInputBuffer creates a new input buffer
func NewInputBuffer(maxSize int, errorHandler func(error)) *InputBuffer {
	return &InputBuffer{
		buffer:       make([]tea.KeyPressMsg, 0, maxSize),
		maxSize:      maxSize,
		flushChan:    make(chan []tea.KeyPressMsg, 1),
		blockChan:    make(chan bool, 1),
		errorHandler: errorHandler,
	}
}

// AddKey adds a key to the buffer if blocked, otherwise returns false
func (ib *InputBuffer) AddKey(key tea.KeyPressMsg) bool {
	ib.mutex.Lock()
	defer ib.mutex.Unlock()

	if !ib.isBlocked {
		return false // Not blocked, handle key normally
	}

	// Check if buffer is full
	if len(ib.buffer) >= ib.maxSize {
		if ib.errorHandler != nil {
			ib.errorHandler(fmt.Errorf("input buffer overflow, dropping key: %s", key.String()))
		}
		// Drop oldest key and add new one
		ib.buffer = ib.buffer[1:]
	}

	ib.buffer = append(ib.buffer, key)
	return true // Key was buffered
}

// SetBlocked sets the blocked state
func (ib *InputBuffer) SetBlocked(blocked bool) {
	ib.mutex.Lock()
	defer ib.mutex.Unlock()

	if ib.isBlocked == blocked {
		return // No change
	}

	ib.isBlocked = blocked
	
	// Notify blocking state change
	select {
	case ib.blockChan <- blocked:
	default:
		// Channel full, skip notification
	}

	if !blocked && len(ib.buffer) > 0 {
		// Flush buffer when unblocked
		bufferedKeys := make([]tea.KeyPressMsg, len(ib.buffer))
		copy(bufferedKeys, ib.buffer)
		ib.buffer = ib.buffer[:0] // Clear buffer

		// Send flushed keys
		select {
		case ib.flushChan <- bufferedKeys:
		default:
			// Channel full, handle gracefully
			if ib.errorHandler != nil {
				ib.errorHandler(fmt.Errorf("failed to flush %d buffered keys", len(bufferedKeys)))
			}
		}
	}
}

// FlushChannel returns the channel for receiving flushed keys
func (ib *InputBuffer) FlushChannel() <-chan []tea.KeyPressMsg {
	return ib.flushChan
}

// BlockChannel returns the channel for receiving block state changes
func (ib *InputBuffer) BlockChannel() <-chan bool {
	return ib.blockChan
}

// Clear clears the buffer
func (ib *InputBuffer) Clear() {
	ib.mutex.Lock()
	defer ib.mutex.Unlock()
	ib.buffer = ib.buffer[:0]
}

// IsBlocked returns current blocked state
func (ib *InputBuffer) IsBlocked() bool {
	ib.mutex.RLock()
	defer ib.mutex.RUnlock()
	return ib.isBlocked
}

// GetBufferSize returns current buffer size
func (ib *InputBuffer) GetBufferSize() int {
	ib.mutex.RLock()
	defer ib.mutex.RUnlock()
	return len(ib.buffer)
}

// GetStats returns buffer statistics
func (ib *InputBuffer) GetStats() BufferStats {
	ib.mutex.RLock()
	defer ib.mutex.RUnlock()
	
	return BufferStats{
		CurrentSize: len(ib.buffer),
		MaxSize:     ib.maxSize,
		IsBlocked:   ib.isBlocked,
	}
}

// BufferStats contains buffer statistics
type BufferStats struct {
	CurrentSize int
	MaxSize     int
	IsBlocked   bool
}

// InputBufferManager manages multiple input buffers and coordination
type InputBufferManager struct {
	keyBuffer    *InputBuffer
	responseTime time.Time
	isResponding bool
	mutex        sync.RWMutex
}

// NewInputBufferManager creates a new input buffer manager
func NewInputBufferManager(errorHandler func(error)) *InputBufferManager {
	return &InputBufferManager{
		keyBuffer: NewInputBuffer(100, errorHandler), // Buffer up to 100 keystrokes
	}
}

// StartResponse marks the start of a long operation (AI response)
func (ibm *InputBufferManager) StartResponse() {
	ibm.mutex.Lock()
	defer ibm.mutex.Unlock()
	
	ibm.isResponding = true
	ibm.responseTime = time.Now()
	ibm.keyBuffer.SetBlocked(true)
}

// EndResponse marks the end of a long operation
func (ibm *InputBufferManager) EndResponse() {
	ibm.mutex.Lock()
	defer ibm.mutex.Unlock()
	
	ibm.isResponding = false
	ibm.keyBuffer.SetBlocked(false)
}

// HandleKey handles a key input, returning true if buffered
func (ibm *InputBufferManager) HandleKey(key tea.KeyPressMsg) bool {
	return ibm.keyBuffer.AddKey(key)
}

// GetKeyBuffer returns the key buffer
func (ibm *InputBufferManager) GetKeyBuffer() *InputBuffer {
	return ibm.keyBuffer
}

// IsResponding returns if currently responding
func (ibm *InputBufferManager) IsResponding() bool {
	ibm.mutex.RLock()
	defer ibm.mutex.RUnlock()
	return ibm.isResponding
}

// GetResponseDuration returns how long the current response has been running
func (ibm *InputBufferManager) GetResponseDuration() time.Duration {
	ibm.mutex.RLock()
	defer ibm.mutex.RUnlock()
	
	if !ibm.isResponding {
		return 0
	}
	return time.Since(ibm.responseTime)
}