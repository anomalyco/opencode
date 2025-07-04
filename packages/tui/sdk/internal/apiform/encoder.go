package apiform

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/textproto"
	"path"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sst/opencode-sdk-go/internal/param"
)

var encoders sync.Map // map[encoderEntry]encoderFunc

func Marshal(value interface{}, writer *multipart.Writer) error {
	e := &encoder{dateFormat: time.RFC3339}
	return e.marshal(value, writer)
}

func MarshalRoot(value interface{}, writer *multipart.Writer) error {
	e := &encoder{root: true, dateFormat: time.RFC3339}
	return e.marshal(value, writer)
}

type encoder struct {
	dateFormat string
	root       bool
}

type encoderFunc func(key string, value reflect.Value, writer *multipart.Writer) error

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

func (e *encoder) marshal(value interface{}, writer *multipart.Writer) error {
	val := reflect.ValueOf(value)
	if !val.IsValid() {
		return nil
	}
	typ := val.Type()
	enc := e.typeEncoder(typ)
	return enc("", val, writer)
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
	fi, loaded := encoders.LoadOrStore(entry, encoderFunc(func(key string, v reflect.Value, writer *multipart.Writer) error {
		wg.Wait()
		return f(key, v, writer)
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

func (e *encoder) newTypeEncoder(t reflect.Type) encoderFunc {
	if t.ConvertibleTo(reflect.TypeOf(time.Time{})) {
		return e.newTimeTypeEncoder()
	}
	if t.ConvertibleTo(reflect.TypeOf((*io.Reader)(nil)).Elem()) {
		return e.newReaderTypeEncoder()
	}
	e.root = false
	switch t.Kind() {
	case reflect.Pointer:
		inner := t.Elem()

		innerEncoder := e.typeEncoder(inner)
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			if !v.IsValid() || v.IsNil() {
				return nil
			}
			return innerEncoder(key, v.Elem(), writer)
		}
	case reflect.Struct:
		return e.newStructTypeEncoder(t)
	case reflect.Slice, reflect.Array:
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
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return writer.WriteField(key, v.String())
		}
	case reflect.Bool:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			if v.Bool() {
				return writer.WriteField(key, "true")
			}
			return writer.WriteField(key, "false")
		}
	case reflect.Int, reflect.Int16, reflect.Int32, reflect.Int64:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return writer.WriteField(key, strconv.FormatInt(v.Int(), 10))
		}
	case reflect.Uint, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return writer.WriteField(key, strconv.FormatUint(v.Uint(), 10))
		}
	case reflect.Float32:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return writer.WriteField(key, strconv.FormatFloat(v.Float(), 'f', -1, 32))
		}
	case reflect.Float64:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return writer.WriteField(key, strconv.FormatFloat(v.Float(), 'f', -1, 64))
		}
	default:
		return func(key string, v reflect.Value, writer *multipart.Writer) error {
			return fmt.Errorf("unknown type received at primitive encoder: %s", t.String())
		}
	}
}

func (e *encoder) newArrayTypeEncoder(t reflect.Type) encoderFunc {
	itemEncoder := e.typeEncoder(t.Elem())

	return func(key string, v reflect.Value, writer *multipart.Writer) error {
		if key != "" {
			key = key + "."
		}
		for i := 0; i < v.Len(); i++ {
			err := itemEncoder(key+strconv.Itoa(i), v.Index(i), writer)
			if err != nil {
				return err
			}
		}
		return nil
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
			ptag, ok := parseFormStructTag(field)
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

	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		if key != "" {
			key = key + "."
		}

		for _, ef := range encoderFields {
			field := value.FieldByIndex(ef.idx)
			err := ef.fn(key+ef.tag.name, field, writer)
			if err != nil {
				return err
			}
		}

		if extraEncoder != nil {
			err := e.encodeMapEntries(key, value.FieldByIndex(extraEncoder.idx), writer)
			if err != nil {
				return err
			}
		}

		return nil
	}
}

func (e *encoder) newFieldTypeEncoder(t reflect.Type) encoderFunc {
	f, _ := t.FieldByName("Value")
	enc := e.typeEncoder(f.Type)

	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		present := value.FieldByName("Present")
		if !present.Bool() {
			return nil
		}
		null := value.FieldByName("Null")
		if null.Bool() {
			return nil
		}
		raw := value.FieldByName("Raw")
		if !raw.IsNil() {
			return e.typeEncoder(raw.Type())(key, raw, writer)
		}
		return enc(key, value.FieldByName("Value"), writer)
	}
}

func (e *encoder) newTimeTypeEncoder() encoderFunc {
	format := e.dateFormat
	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		return writer.WriteField(key, value.Convert(reflect.TypeOf(time.Time{})).Interface().(time.Time).Format(format))
	}
}

func (e encoder) newInterfaceEncoder() encoderFunc {
	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		value = value.Elem()
		if !value.IsValid() {
			return nil
		}
		return e.typeEncoder(value.Type())(key, value, writer)
	}
}

var quoteEscaper = strings.NewReplacer("\\", "\\\\", `"`, "\\\"")

func escapeQuotes(s string) string {
	return quoteEscaper.Replace(s)
}

func (e *encoder) newReaderTypeEncoder() encoderFunc {
	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		reader := value.Convert(reflect.TypeOf((*io.Reader)(nil)).Elem()).Interface().(io.Reader)
		filename := "anonymous_file"
		contentType := "application/octet-stream"
		if named, ok := reader.(interface{ Filename() string }); ok {
			filename = named.Filename()
		} else if named, ok := reader.(interface{ Name() string }); ok {
			filename = path.Base(named.Name())
		}
		if typed, ok := reader.(interface{ ContentType() string }); ok {
			contentType = typed.ContentType()
		}

		// Below is taken almost 1-for-1 from [multipart.CreateFormFile]
		h := make(textproto.MIMEHeader)
		h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, escapeQuotes(key), escapeQuotes(filename)))
		h.Set("Content-Type", contentType)
		filewriter, err := writer.CreatePart(h)
		if err != nil {
			return err
		}
		_, err = io.Copy(filewriter, reader)
		return err
	}
}

// Given a []byte of json (may either be an empty object or an object that already contains entries)
// encode all of the entries in the map to the json byte array.
func (e *encoder) encodeMapEntries(key string, v reflect.Value, writer *multipart.Writer) error {
	type mapPair struct {
		key   string
		value reflect.Value
	}

	if key != "" {
		key = key + "."
	}

	pairs := []mapPair{}

	iter := v.MapRange()
	for iter.Next() {
		if iter.Key().Type().Kind() == reflect.String {
			pairs = append(pairs, mapPair{key: iter.Key().String(), value: iter.Value()})
		} else {
			return fmt.Errorf("cannot encode a map with a non string key")
		}
	}

	// Ensure deterministic output
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].key < pairs[j].key
	})

	elementEncoder := e.typeEncoder(v.Type().Elem())
	for _, p := range pairs {
		err := elementEncoder(key+string(p.key), p.value, writer)
		if err != nil {
			return err
		}
	}

	return nil
}

func (e *encoder) newMapEncoder(t reflect.Type) encoderFunc {
	return func(key string, value reflect.Value, writer *multipart.Writer) error {
		return e.encodeMapEntries(key, value, writer)
	}
}
