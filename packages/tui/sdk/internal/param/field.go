package param

import (
	"fmt"
)

type FieldLike interface{ field() }

// Field is a wrapper used for all values sent to the API,
// to distinguish zero values from null or omitted fields.
//
// It also allows sending arbitrary deserializable values.
//
// To instantiate a Field, use the helpers exported from
// the package root: `F()`, `Null()`, `Raw()`, etc.
type Field[T any] struct {
	FieldLike
	Value   T
	Null    bool
	Present bool
	Raw     any
}

func (f Field[T]) String() string {
	if s, ok := any(f.Value).(fmt.Stringer); ok {
		return s.String()
	}
	return fmt.Sprintf("%v", f.Value)
}
