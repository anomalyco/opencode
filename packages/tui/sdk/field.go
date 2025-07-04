package opencode

import (
	"github.com/sst/opencode-sdk-go/internal/param"
	"io"
)

// F is a param field helper used to initialize a [param.Field] generic struct.
// This helps specify null, zero values, and overrides, as well as normal values.
// You can read more about this in our [README].
//
// [README]: https://pkg.go.dev/github.com/sst/opencode-sdk-go#readme-request-fields
func F[T any](value T) param.Field[T] { return param.Field[T]{Value: value, Present: true} }

// Null is a param field helper which explicitly sends null to the API.
func Null[T any]() param.Field[T] { return param.Field[T]{Null: true, Present: true} }

// Raw is a param field helper for specifying values for fields when the
// type you are looking to send is different from the type that is specified in
// the SDK. For example, if the type of the field is an integer, but you want
// to send a float, you could do that by setting the corresponding field with
// Raw[int](0.5).
func Raw[T any](value any) param.Field[T] { return param.Field[T]{Raw: value, Present: true} }

// Int is a param field helper which helps specify integers. This is
// particularly helpful when specifying integer constants for fields.
func Int(value int64) param.Field[int64] { return F(value) }

// String is a param field helper which helps specify strings.
func String(value string) param.Field[string] { return F(value) }

// Float is a param field helper which helps specify floats.
func Float(value float64) param.Field[float64] { return F(value) }

// Bool is a param field helper which helps specify bools.
func Bool(value bool) param.Field[bool] { return F(value) }

// FileParam is a param field helper which helps files with a mime content-type.
func FileParam(reader io.Reader, filename string, contentType string) param.Field[io.Reader] {
	return F[io.Reader](&file{reader, filename, contentType})
}

type file struct {
	io.Reader
	name        string
	contentType string
}

func (f *file) ContentType() string { return f.contentType }
func (f *file) Filename() string    { return f.name }
