package apiquery

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sst/opencode-sdk-go/internal/param"
)

var encoders sync.Map // map[reflect.Type]encoderFunc

type encoder struct {
	dateFormat string
	root       bool
	settings   QuerySettings
}

type encoderFunc func(key string, value reflect.Value) []Pair

type encoderField struct {
	tag parsedStructTag
	fn  encoderFunc
	idx []int
}

type encoderEntry struct {
	reflect.Type
	dateFormat string
	root       bool
	settings   QuerySettings
}

type Pair struct {
	key   string
	value string
}

func (e *encoder) typeEncoder(t reflect.Type) encoderFunc {
	entry := encoderEntry{
		Type:       t,
		dateFormat: e.dateFormat,
		root:       e.root,
		settings:   e.settings,
	}

	if fi, ok := encoders.Load(entry); ok {
		return fi.(encoderFunc)
	}

	// To deal with recursive types, populate the map with an
	// indirect func before we build it. This type waits on the
	// real func (f) to be ready and then calls it. This indirect
	// func is only used for recursive types.
	var (
		wg sync.WaitGroup
		f  encoderFunc
	)
	wg.Add(1)
	fi, loaded := encoders.LoadOrStore(entry, encoderFunc(func(key string, v reflect.Value) []Pair {
		wg.Wait()
		return f(key, v)
	}))
	if loaded {
		return fi.(encoderFunc)
	}

	// Compute the real encoder and replace the indirect func with it.
	f = e.newTypeEncoder(t)
	wg.Done()
	encoders.Store(entry, f)
	return f
}

func marshalerEncoder(key string, value reflect.Value) []Pair {
	s, _ := value.Interface().(json.Marshaler).MarshalJSON()
	return []Pair{{key, string(s)}}
}

func (e *encoder) newTypeEncoder(t reflect.Type) encoderFunc {
	if t.ConvertibleTo(reflect.TypeOf(time.Time{})) {
		return e.newTimeTypeEncoder(t)
	}
	if !e.root && t.Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) {
		return marshalerEncoder
	}
	e.root = false
	switch t.Kind() {
	case reflect.Pointer:
		encoder := e.typeEncoder(t.Elem())
		return func(key string, value reflect.Value) (pairs []Pair) {
			if !value.IsValid() || value.IsNil() {
				return
			}
			pairs = encoder(key, value.Elem())
			return
		}
	case reflect.Struct:
		return e.newStructTypeEncoder(t)
	case reflect.Array:
		fallthrough
	case reflect.Slice:
		return e.newArrayTypeEncoder(t)
	case reflect.Map:
		return e.newMapEncoder(t)
	case reflect.Interface:
		return e.newInterfaceEncoder()
	default:
		return e.newPrimitiveTypeEncoder(t)
	}
}

func (e *encoder) newStructTypeEncoder(t reflect.Type) encoderFunc {
	if t.Implements(reflect.TypeOf((*param.FieldLike)(nil)).Elem()) {
		return e.newFieldTypeEncoder(t)
	}

	encoderFields := []encoderField{}

	// This helper allows us to recursively collect field encoders into a flat
	// array. The parameter `index` keeps track of the access patterns necessary
	// to get to some field.
	var collectEncoderFields func(r reflect.Type, index []int)
	collectEncoderFields = func(r reflect.Type, index []int) {
		for i := 0; i < r.NumField(); i++ {
			idx := append(index, i)
			field := t.FieldByIndex(idx)
			if !field.IsExported() {
				continue
			}
			// If this is an embedded struct, traverse one level deeper to extract
			// the field and get their encoders as well.
			if field.Anonymous {
				collectEncoderFields(field.Type, idx)
				continue
			}
			// If query tag is not present, then we skip, which is intentionally
			// different behavior from the stdlib.
			ptag, ok := parseQueryStructTag(field)
			if !ok {
				continue
			}

			if ptag.name == "-" && !ptag.inline {
				continue
			}

			dateFormat, ok := parseFormatStructTag(field)
			oldFormat := e.dateFormat
			if ok {
				switch dateFormat {
				case "date-time":
					e.dateFormat = time.RFC3339
				case "date":
					e.dateFormat = "2006-01-02"
				}
			}
			encoderFields = append(encoderFields, encoderField{ptag, e.typeEncoder(field.Type), idx})
			e.dateFormat = oldFormat
		}
	}
	collectEncoderFields(t, []int{})

	return func(key string, value reflect.Value) (pairs []Pair) {
		for _, ef := range encoderFields {
			var subkey string = e.renderKeyPath(key, ef.tag.name)
			if ef.tag.inline {
				subkey = key
			}

			field := value.FieldByIndex(ef.idx)
			pairs = append(pairs, ef.fn(subkey, field)...)
		}
		return
	}
}

func (e *encoder) newMapEncoder(t reflect.Type) encoderFunc {
	keyEncoder := e.typeEncoder(t.Key())
	elementEncoder := e.typeEncoder(t.Elem())
	return func(key string, value reflect.Value) (pairs []Pair) {
		iter := value.MapRange()
		for iter.Next() {
			encodedKey := keyEncoder("", iter.Key())
			if len(encodedKey) != 1 {
				panic("Unexpected number of parts for encoded map key. Are you using a non-primitive for this map?")
			}
			subkey := encodedKey[0].value
			keyPath := e.renderKeyPath(key, subkey)
			pairs = append(pairs, elementEncoder(keyPath, iter.Value())...)
		}
		return
	}
}

func (e *encoder) renderKeyPath(key string, subkey string) string {
	if len(key) == 0 {
		return subkey
	}
	if e.settings.NestedFormat == NestedQueryFormatDots {
		return fmt.Sprintf("%s.%s", key, subkey)
	}
	return fmt.Sprintf("%s[%s]", key, subkey)
}

func (e *encoder) newArrayTypeEncoder(t reflect.Type) encoderFunc {
	switch e.settings.ArrayFormat {
	case ArrayQueryFormatComma:
		innerEncoder := e.typeEncoder(t.Elem())
		return func(key string, v reflect.Value) []Pair {
			elements := []string{}
			for i := 0; i < v.Len(); i++ {
				for _, pair := range innerEncoder("", v.Index(i)) {
					elements = append(elements, pair.value)
				}
			}
			if len(elements) == 0 {
				return []Pair{}
			}
			return []Pair{{key, strings.Join(elements, ",")}}
		}
	case ArrayQueryFormatRepeat:
		innerEncoder := e.typeEncoder(t.Elem())
		return func(key string, value reflect.Value) (pairs []Pair) {
			for i := 0; i < value.Len(); i++ {
				pairs = append(pairs, innerEncoder(key, value.Index(i))...)
			}
			return pairs
		}
	case ArrayQueryFormatIndices:
		panic("The array indices format is not supported yet")
	case ArrayQueryFormatBrackets:
		innerEncoder := e.typeEncoder(t.Elem())
		return func(key string, value reflect.Value) []Pair {
			pairs := []Pair{}
			for i := 0; i < value.Len(); i++ {
				pairs = append(pairs, innerEncoder(key+"[]", value.Index(i))...)
			}
			return pairs
		}
	default:
		panic(fmt.Sprintf("Unknown ArrayFormat value: %d", e.settings.ArrayFormat))
	}
}

func (e *encoder) newPrimitiveTypeEncoder(t reflect.Type) encoderFunc {
	switch t.Kind() {
	case reflect.Pointer:
		inner := t.Elem()

		innerEncoder := e.newPrimitiveTypeEncoder(inner)
		return func(key string, v reflect.Value) []Pair {
			if !v.IsValid() || v.IsNil() {
				return nil
			}
			return innerEncoder(key, v.Elem())
		}
	case reflect.String:
		return func(key string, v reflect.Value) []Pair {
			return []Pair{{key, v.String()}}
		}
	case reflect.Bool:
		return func(key string, v reflect.Value) []Pair {
			if v.Bool() {
				return []Pair{{key, "true"}}
			}
			return []Pair{{key, "false"}}
		}
	case reflect.Int, reflect.Int16, reflect.Int32, reflect.Int64:
		return func(key string, v reflect.Value) []Pair {
			return []Pair{{key, strconv.FormatInt(v.Int(), 10)}}
		}
	case reflect.Uint, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return func(key string, v reflect.Value) []Pair {
			return []Pair{{key, strconv.FormatUint(v.Uint(), 10)}}
		}
	case reflect.Float32, reflect.Float64:
		return func(key string, v reflect.Value) []Pair {
			return []Pair{{key, strconv.FormatFloat(v.Float(), 'f', -1, 64)}}
		}
	case reflect.Complex64, reflect.Complex128:
		bitSize := 64
		if t.Kind() == reflect.Complex128 {
			bitSize = 128
		}
		return func(key string, v reflect.Value) []Pair {
			return []Pair{{key, strconv.FormatComplex(v.Complex(), 'f', -1, bitSize)}}
		}
	default:
		return func(key string, v reflect.Value) []Pair {
			return nil
		}
	}
}

func (e *encoder) newFieldTypeEncoder(t reflect.Type) encoderFunc {
	f, _ := t.FieldByName("Value")
	enc := e.typeEncoder(f.Type)

	return func(key string, value reflect.Value) []Pair {
		present := value.FieldByName("Present")
		if !present.Bool() {
			return nil
		}
		null := value.FieldByName("Null")
		if null.Bool() {
			// TODO: Error?
			return nil
		}
		raw := value.FieldByName("Raw")
		if !raw.IsNil() {
			return e.typeEncoder(raw.Type())(key, raw)
		}
		return enc(key, value.FieldByName("Value"))
	}
}

func (e *encoder) newTimeTypeEncoder(t reflect.Type) encoderFunc {
	format := e.dateFormat
	return func(key string, value reflect.Value) []Pair {
		return []Pair{{
			key,
			value.Convert(reflect.TypeOf(time.Time{})).Interface().(time.Time).Format(format),
		}}
	}
}

func (e encoder) newInterfaceEncoder() encoderFunc {
	return func(key string, value reflect.Value) []Pair {
		value = value.Elem()
		if !value.IsValid() {
			return nil
		}
		return e.typeEncoder(value.Type())(key, value)
	}

}
