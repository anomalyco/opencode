package util

import (
	"strings"
)

func mapParallel[in, out any](items []in, fn func(in) out) chan out {
	mapChans := make([]chan out, 0, len(items))

	for _, v := range items {
		ch := make(chan out)
		mapChans = append(mapChans, ch)
		go func() {
			defer close(ch)
			ch <- fn(v)
		}()
	}

	resultChan := make(chan out)

	go func() {
		defer close(resultChan)
		for _, ch := range mapChans {
			v := <-ch
			resultChan <- v
		}
	}()

	return resultChan
}

// WriteStringsPar allows to iterate over a list and compute strings in parallel,
// yet write them in order.
func WriteStringsPar[a any](sb *strings.Builder, items []a, fn func(a) string) {
	ch := mapParallel(items, fn)

	for v := range ch {
		sb.WriteString(v)
	}
}
