package util

import (
	"testing"
	"time"
)

func TestContextTimeouts(t *testing.T) {
	t.Run("short timeout", func(t *testing.T) {
		ctx, cancel := WithShortTimeout()
		defer cancel()

		select {
		case <-ctx.Done():
			t.Error("Context should not timeout immediately")
		case <-time.After(10 * time.Millisecond):
			// OK - context still alive after 10ms
		}

		time.Sleep(ShortTimeout + 100*time.Millisecond)

		select {
		case <-ctx.Done():
			// OK - context has timed out as expected
		default:
			t.Error("Context should have timed out")
		}
	})

	t.Run("medium timeout", func(t *testing.T) {
		ctx, cancel := WithMediumTimeout()
		defer cancel()

		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("Context should have a deadline")
		}

		expectedDeadline := time.Now().Add(MediumTimeout)
		if deadline.Sub(expectedDeadline) > time.Second {
			t.Error("Deadline not set correctly")
		}
	})

	t.Run("long timeout", func(t *testing.T) {
		ctx, cancel := WithLongTimeout()
		defer cancel()

		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("Context should have a deadline")
		}

		expectedDeadline := time.Now().Add(LongTimeout)
		if deadline.Sub(expectedDeadline) > time.Second {
			t.Error("Deadline not set correctly")
		}
	})

	t.Run("custom timeout", func(t *testing.T) {
		customDuration := 100 * time.Millisecond
		ctx, cancel := WithCustomTimeout(customDuration)
		defer cancel()

		deadline, ok := ctx.Deadline()
		if !ok {
			t.Error("Context should have a deadline")
		}

		expectedDeadline := time.Now().Add(customDuration)
		if deadline.Sub(expectedDeadline) > time.Second {
			t.Error("Deadline not set correctly")
		}

		// Test actual timeout
		select {
		case <-ctx.Done():
			t.Error("Context should not timeout immediately")
		case <-time.After(50 * time.Millisecond):
			// OK - context still alive at half duration
		}

		time.Sleep(customDuration + 50*time.Millisecond)

		select {
		case <-ctx.Done():
			// OK - context has timed out as expected
		default:
			t.Error("Context should have timed out")
		}
	})

	t.Run("cancel propagation", func(t *testing.T) {
		ctx, cancel := WithMediumTimeout()
		defer cancel()

		// Create a channel to track goroutine completion
		done := make(chan struct{})

		go func() {
			<-ctx.Done()
			close(done)
		}()

		// Cancel the context
		cancel()

		// Wait for goroutine to finish or timeout
		select {
		case <-done:
			// OK - goroutine received cancellation
		case <-time.After(100 * time.Millisecond):
			t.Error("Cancel not propagated to goroutine")
		}
	})
}
