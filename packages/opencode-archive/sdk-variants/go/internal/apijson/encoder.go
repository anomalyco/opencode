package apijson

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/sjson"

	"github.com/sst/opencode-sdk-go/internal/param"
)

var encoders sync.Map // map[encoderEntry]encoderFunc

// If we want to set a literal key value into JSON using sjson, we need to make sure it doesn't have
// special characters that sjson interprets as a path.
var EscapeSJSONKey = strings.NewReplacer("\\", "\\\\", "|", "\\|", "#", "\\#", "@", "\\@", "*", "\\*", ".", "\\.", ":", "\\:", "?", "\\?").Replace

func Marshal(value interface{}) ([]byte, error) {
	e := &encoder{dateFormat: time.RFC3339}
	return e.marshal(value)
}

func MarshalRoot(value interface{}) ([]byte, error) {
	e := &encoder{root: true, dateFormat: time.RFC3339}
	return e.marshal(value)
}

type encoder struct {
	dateFormat string
	root       bool
}

type encoderFunc func(value reflect.Value) ([]byte, error)

type encoderField struct {
	tag parsedStructTag
	fn  encoderFunc
	idx []int
}

type encoderEntry struct {
	reflect.Type
	dateFormat string
	root       bool
}

func (e *encoder) marshal(value interface{}) ([]byte, error) {
	val := reflect.ValueOf(value)
	if !val.IsValid() {
		return nil, nil
	}
	typ := val.Type()
	enc := e.typeEncoder(typ)
	return enc(val)
}

func (e *encoder) typeEncoder(t reflect.Type) encoderFunc {
	entry := encoderEntry{
		Type:       t,
		dateFormat: e.dateFormat,
		root:       e.root,
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
	fi, loaded := encoders.LoadOrStore(entry, encoderFunc(func(v reflect.Value) ([]byte, error) {
		wg.Wait()
		return f(v)
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

func marshalerEncoder(v reflect.Value) ([]byte, error) {
	return v.Interface().(json.Marshaler).MarshalJSON()
}

func indirectMarshalerEncoder(v reflect.Value) ([]byte, error) {
	return v.Addr().Interface().(json.Marshaler).MarshalJSON()
}

func (e *encoder) newTypeEncoder(t reflect.Type) encoderFunc {
	if t.ConvertibleTo(reflect.TypeOf(time.Time{})) {
		return e.newTimeTypeEncoder()
	}
	if !e.root && t.Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) {
		return marshalerEncoder
	}
	if !e.root && reflect.PointerTo(t).Implements(reflect.TypeOf((*json.Marshaler)(nil)).Elem()) {
		return indirectMarshalerEncoder
	}
	e.root = false
	switch t.Kind() {
	case reflect.Pointer:
		inner := t.Elem()

		innerEncoder := e.typeEncoder(inner)
		return func(v reflect.Value) ([]byte, error) {
			if !v.IsValid() || v.IsNil() {
				return nil, nil
			}
			return innerEncoder(v.Elem())
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

func (e *encoder) newPrimitiveTypeEncoder(t reflect.Type) encoderFunc {
	switch t.Kind() {
	// Note that we could use `gjson` to encode these types but it would complicate our
	// code more and this current code shouldn't cause any issues
	case reflect.String:
		return func(v reflect.Value) ([]byte, error) {
			return json.Marshal(v.Interface())
		}
	case reflect.Bool:
		return func(v reflect.Value) ([]byte, error) {
			if v.Bool() {
				return []byte("true"), nil
			}
			return []byte("false"), nil
		}
	case reflect.Int, reflect.Int16, reflect.Int32, reflect.Int64:
		return func(v reflect.Value) ([]byte, error) {
			return []byte(strconv.FormatInt(v.Int(), 10)), nil
		}
	case reflect.Uint, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return func(v reflect.Value) ([]byte, error) {
			return []byte(strconv.FormatUint(v.Uint(), 10)), nil
		}
	case reflect.Float32:
		return func(v reflect.Value) ([]byte, error) {
			return []byte(strconv.FormatFloat(v.Float(), 'f', -1, 32)), nil
		}
	case reflect.Float64:
		return func(v reflect.Value) ([]byte, error) {
			return []byte(strconv.FormatFloat(v.Float(), 'f', -1, 64)), nil
		}
	default:
		return func(v reflect.Value) ([]byte, error) {
			return nil, fmt.Errorf("unknown type received at primitive encoder: %s", t.String())
		}
	}
}

func (e *encoder) newArrayTypeEncoder(t reflect.Type) encoderFunc {
	itemEncoder := e.typeEncoder(t.Elem())

	return func(value reflect.Value) ([]byte, error) {
		json := []byte("[]")
		for i := 0; i < value.Len(); i++ {
			var value, err = itemEncoder(value.Index(i))
			if err != nil {
				return nil, err
			}
			if value == nil {
				// Assume that empty items should be inserted as `null` so that the output array
				// will be the same length as the input array
				value = []byte("null")
			}

			json, err = sjson.SetRawBytes(json, "-1", value)
			if err != nil {
				return nil, err
			}
		}

		return json, nil
	}
}

func (e *encoder) newStructTypeEncoder(t reflect.Type) encoderFunc {
	if t.Implements(reflect.TypeOf((*param.FieldLike)(nil)).Elem()) {
		return e.newFieldTypeEncoder(t)
	}

	encoderFields := []encoderField{}
	extraEncoder := (*encoderField)(nil)

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
			// If json tag is not present, then we skip, which is intentionally
			// different behavior from the stdlib.
			ptag, ok := parseJSONStructTag(field)
			if !ok {
				continue
			}
			// We only want to support unexported field if they're tagged with
			// `extras` because that field shouldn't be part of the public API. We
			// also want to only keep the top level extras
			if ptag.extras && len(index) == 0 {
				extraEncoder = &encoderField{ptag, e.typeEncoder(field.Type.Elem()), idx}
				continue
			}
			if ptag.name == "-" {
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

	// Ensure deterministic output by sorting by lexicographic order
	sort.Slice(encoderFields, func(i, j int) bool {
		return encoderFields[i].tag.name < encoderFields[j].tag.name
	})

	return func(value reflect.Value) (json []byte, err error) {
		json = []byte("{}")

		for _, ef := range encoderFields {
			field := value.FieldByIndex(ef.idx)
			encoded, err := ef.fn(field)
			if err != nil {
				return nil, err
			}
			if encoded == nil {
				continue
			}
			json, err = sjson.SetRawBytes(json, EscapeSJSONKey(ef.tag.name), encoded)
			if err != nil {
				return nil, err
			}
		}

		if extraEncoder != nil {
			json, err = e.encodeMapEntries(json, value.FieldByIndex(extraEncoder.idx))
			if err != nil {
				return nil, err
			}
		}
		return
	}
}

func (e *encoder) newFieldTypeEncoder(t reflect.Type) encoderFunc {
	f, _ := t.FieldByName("Value")
	enc := e.typeEncoder(f.Type)

	return func(value reflect.Value) (json []byte, err error) {
		present := value.FieldByName("Present")
		if !present.Bool() {
			return nil, nil
		}
		null := value.FieldByName("Null")
		if null.Bool() {
			return []byte("null"), nil
		}
		raw := value.FieldByName("Raw")
		if !raw.IsNil() {
			return e.typeEncoder(raw.Type())(raw)
		}
		return enc(value.FieldByName("Value"))
	}
}

func (e *encoder) newTimeTypeEncoder() encoderFunc {
	format := e.dateFormat
	return func(value reflect.Value) (json []byte, err error) {
		return []byte(`"` + value.Convert(reflect.TypeOf(time.Time{})).Interface().(time.Time).Format(format) + `"`), nil
	}
}

func (e encoder) newInterfaceEncoder() encoderFunc {
	return func(value reflect.Value) ([]byte, error) {
		value = value.Elem()
		if !value.IsValid() {
			return nil, nil
		}
		return e.typeEncoder(value.Type())(value)
	}
}

// Given a []byte of json (may either be an empty object or an object that already contains entries)
// encode all of the entries in the map to the json byte array.
func (e *encoder) encodeMapEntries(json []byte, v reflect.Value) ([]byte, error) {
	type mapPair struct {
		key   []byte
		value reflect.Value
	}

	pairs := []mapPair{}
	keyEncoder := e.typeEncoder(v.Type().Key())

	iter := v.MapRange()
	for iter.Next() {
		var encodedKeyString string
		if iter.Key().Type().Kind() == reflect.String {
			encodedKeyString = iter.Key().String()
		} else {
			var err error
			encodedKeyBytes, err := keyEncoder(iter.Key())
			if err != nil {
				return nil, err
			}
			encodedKeyString = string(encodedKeyBytes)
		}
		encodedKey := []byte(encodedKeyString)
		pairs = append(pairs, mapPair{key: encodedKey, value: iter.Value()})
	}

	// Ensure deterministic output
	sort.Slice(pairs, func(i, j int) bool {
		return bytes.Compare(pairs[i].key, pairs[j].key) < 0
	})

	elementEncoder := e.typeEncoder(v.Type().Elem())
	for _, p := range pairs {
		encodedValue, err := elementEncoder(p.value)
		if err != nil {
			return nil, err
		}
		if len(encodedValue) == 0 {
			continue
		}
		json, err = sjson.SetRawBytes(json, EscapeSJSONKey(string(p.key)), encodedValue)
		if err != nil {
			return nil, err
		}
	}

	return json, nil
}

func (e *encoder) newMapEncoder(t reflect.Type) encoderFunc {
	return func(value reflect.Value) ([]byte, error) {
		json := []byte("{}")
		var err error
		json, err = e.encodeMapEntries(json, value)
		if err != nil {
			return nil, err
		}
		return json, nil
	}
}
