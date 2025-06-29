package util

import (
	"strings"
	"sync"
)

// MapReducePar performs a parallel map-reduce operation on a slice of items.
// It applies a function to each item in the slice concurrently,
// and combines the results serially using a reducer returned from
// each one of the functions, allowing the use of closures.
func MapReducePar[a, b any](items []a, init b, fn func(a) func(b) b) b {
	itemCount := len(items)
	locks := make([]*sync.Mutex, itemCount)
	mapped := make([]func(b) b, itemCount)

	for i, value := range items {
		lock := &sync.Mutex{}
		lock.Lock()
		locks[i] = lock
		go func() {
			defer lock.Unlock()
			mapped[i] = fn(value)
		}()
	}

	result := init
	for i := range itemCount {
		locks[i].Lock()
		defer locks[i].Unlock()
		f := mapped[i]
		if f != nil {
			result = f(result)
		}
	}

	return result
}

// WriteStringsPar allows to iterate over a list and compute strings in parallel,
// yet write them in order.
func WriteStringsPar[a any](sb *strings.Builder, items []a, fn func(a) string) {
	MapReducePar(items, sb, func(item a) func(*strings.Builder) *strings.Builder {
		str := fn(item)
		return func(sbdr *strings.Builder) *strings.Builder {
			sbdr.WriteString(str)
			return sbdr
		}
	})
}
