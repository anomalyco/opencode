package util_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/sst/opencode/internal/util"
)

func TestWriteStringsPar(t *testing.T) {
	items := []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9}
	sb := strings.Builder{}
	util.WriteStringsPar(&sb, items, func(i int) string {
		// sleep for the inverse duration so that later items finish first
		time.Sleep(time.Duration(10-i) * time.Millisecond)
		return strconv.Itoa(i)
	})
	if sb.String() != "0123456789" {
		t.Fatalf("expected 0123456789, got %s", sb.String())
	}
}
