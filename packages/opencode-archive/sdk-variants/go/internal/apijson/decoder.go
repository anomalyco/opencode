package apijson

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"sync"
	"time"
	"unsafe"

	"github.com/tidwall/gjson"
)

// decoders is a synchronized map with roughly the following type:
// map[reflect.Type]decoderFunc
var decoders sync.Map

// Unmarshal is similar to [encoding/json.Unmarshal] and parses the JSON-encoded
// data and stores it in the given pointer.
func Unmarshal(raw []byte, to any) error {
	d := &decoderBuilder{dateFormat: time.RFC3339}
	return d.unmarshal(raw, to)
}

// UnmarshalRoot is like Unmarshal, but doesn't try to call MarshalJSON on the
// root element. Useful if a struct's UnmarshalJSON is overrode to use the
// behavior of this encoder versus the standard library.
func UnmarshalRoot(raw []byte, to any) error {
	d := &decoderBuilder{dateFormat: time.RFC3339, root: true}
	return d.unmarshal(raw, to)
}

// decoderBuilder contains the 'compile-time' state of the decoder.
type decoderBuilder struct {
	// Whether or not this is the first element and called by [UnmarshalRoot], see
	// the documentation there to see why this is necessary.
	root bool
	// The dateFormat (a format string for [time.Format]) which is chosen by the
	// last struct tag that was seen.
	dateFormat string
}

// decoderState contains the 'run-time' state of the decoder.
type decoderState struct {
	strict    bool
	exactness exactness
}

// Exactness refers to how close to the type the result was if deserialization
// was successful. This is useful in deserializing unions, where you want to try
// each entry, first with strict, then with looser validation, without actually
// having to do a lot of redundant work by marshalling twice (or maybe even more
// times).
type exactness int8

const (
	// Some values had to fudged a bit, for example by converting a string to an
	// int, or an enum with extra values.
	loose exactness = iota
	// There are some extra arguments, but other wise it matches the union.
	extras
	// Exactly right.
	exact
)

type decoderFunc func(node gjson.Result, value reflect.Value, state *decoderState) error

type decoderField struct {
	tag    parsedStructTag
	fn     decoderFunc
	idx    []int
	goname string
}

type decoderEntry struct {
	reflect.Type
	dateFormat string
	root       bool
}

func (d *decoderBuilder) unmarshal(raw []byte, to any) error {
	value := reflect.ValueOf(to).Elem()
	result := gjson.ParseBytes(raw)
	if !value.IsValid() {
		return fmt.Errorf("apijson: cannot marshal into invalid value")
	}
	return d.typeDecoder(value.Type())(result, value, &decoderState{strict: false, exactness: exact})
}

func (d *decoderBuilder) typeDecoder(t reflect.Type) decoderFunc {
	entry := decoderEntry{
		Type:       t,
		dateFormat: d.dateFormat,
		root:       d.root,
	}

	if fi, ok := decoders.Load(entry); ok {
		return fi.(decoderFunc)
	}

	// To deal with recursive types, populate the map with an
	// indirect func before we build it. This type waits on the
	// real func (f) to be ready and then calls it. This indirect
	// func is only used for recursive types.
	var (
		wg sync.WaitGroup
		f  decoderFunc
	)
	wg.Add(1)
	fi, loaded := decoders.LoadOrStore(entry, decoderFunc(func(node gjson.Result, v reflect.Value, state *decoderState) error {
		wg.Wait()
		return f(node, v, state)
	}))
	if loaded {
		return fi.(decoderFunc)
	}

	// Compute the real decoder and replace the indirect func with it.
	f = d.newTypeDecoder(t)
	wg.Done()
	decoders.Store(entry, f)
	return f
}

func indirectUnmarshalerDecoder(n gjson.Result, v reflect.Value, state *decoderState) error {
	return v.Addr().Interface().(json.Unmarshaler).UnmarshalJSON([]byte(n.Raw))
}

func unmarshalerDecoder(n gjson.Result, v reflect.Value, state *decoderState) error {
	if v.Kind() == reflect.Pointer && v.CanSet() {
		v.Set(reflect.New(v.Type().Elem()))
	}
	return v.Interface().(json.Unmarshaler).UnmarshalJSON([]byte(n.Raw))
}

func (d *decoderBuilder) newTypeDecoder(t reflect.Type) decoderFunc {
	if t.ConvertibleTo(reflect.TypeOf(time.Time{})) {
		return d.newTimeTypeDecoder(t)
	}
	if !d.root && t.Implements(reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()) {
		return unmarshalerDecoder
	}
	if !d.root && reflect.PointerTo(t).Implements(reflect.TypeOf((*json.Unmarshaler)(nil)).Elem()) {
		if _, ok := unionVariants[t]; !ok {
			return indirectUnmarshalerDecoder
		}
	}
	d.root = false

	if _, ok := unionRegistry[t]; ok {
		return d.newUnionDecoder(t)
	}

	switch t.Kind() {
	case reflect.Pointer:
		inner := t.Elem()
		innerDecoder := d.typeDecoder(inner)

		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			if !v.IsValid() {
				return fmt.Errorf("apijson: unexpected invalid reflection value %+#v", v)
			}

			newValue := reflect.New(inner).Elem()
			err := innerDecoder(n, newValue, state)
			if err != nil {
				return err
			}

			v.Set(newValue.Addr())
			return nil
		}
	case reflect.Struct:
		return d.newStructTypeDecoder(t)
	case reflect.Array:
		fallthrough
	case reflect.Slice:
		return d.newArrayTypeDecoder(t)
	case reflect.Map:
		return d.newMapDecoder(t)
	case reflect.Interface:
		return func(node gjson.Result, value reflect.Value, state *decoderState) error {
			if !value.IsValid() {
				return fmt.Errorf("apijson: unexpected invalid value %+#v", value)
			}
			if node.Value() != nil && value.CanSet() {
				value.Set(reflect.ValueOf(node.Value()))
			}
			return nil
		}
	default:
		return d.newPrimitiveTypeDecoder(t)
	}
}

// newUnionDecoder returns a decoderFunc that deserializes into a union using an
// algorithm roughly similar to Pydantic's [smart algorithm].
//
// Conceptually this is equivalent to choosing the best schema based on how 'exact'
// the deserialization is for each of the schemas.
//
// If there is a tie in the level of exactness, then the tie is broken
// left-to-right.
//
// [smart algorithm]: https://docs.pydantic.dev/latest/concepts/unions/#smart-mode
func (d *decoderBuilder) newUnionDecoder(t reflect.Type) decoderFunc {
	unionEntry, ok := unionRegistry[t]
	if !ok {
		panic("apijson: couldn't find union of type " + t.String() + " in union registry")
	}
	decoders := []decoderFunc{}
	for _, variant := range unionEntry.variants {
		decoder := d.typeDecoder(variant.Type)
		decoders = append(decoders, decoder)
	}
	return func(n gjson.Result, v reflect.Value, state *decoderState) error {
		// If there is a discriminator match, circumvent the exactness logic entirely
		for idx, variant := range unionEntry.variants {
			decoder := decoders[idx]
			if variant.TypeFilter != n.Type {
				continue
			}

			if len(unionEntry.discriminatorKey) != 0 {
				discriminatorValue := n.Get(EscapeSJSONKey(unionEntry.discriminatorKey)).Value()
				if discriminatorValue == variant.DiscriminatorValue {
					inner := reflect.New(variant.Type).Elem()
					err := decoder(n, inner, state)
					v.Set(inner)
					return err
				}
			}
		}

		// Set bestExactness to worse than loose
		bestExactness := loose - 1
		for idx, variant := range unionEntry.variants {
			decoder := decoders[idx]
			if variant.TypeFilter != n.Type {
				continue
			}
			sub := decoderState{strict: state.strict, exactness: exact}
			inner := reflect.New(variant.Type).Elem()
			err := decoder(n, inner, &sub)
			if err != nil {
				continue
			}
			if sub.exactness == exact {
				v.Set(inner)
				return nil
			}
			if sub.exactness > bestExactness {
				v.Set(inner)
				bestExactness = sub.exactness
			}
		}

		if bestExactness < loose {
			return errors.New("apijson: was not able to coerce type as union")
		}

		if guardStrict(state, bestExactness != exact) {
			return errors.New("apijson: was not able to coerce type as union strictly")
		}

		return nil
	}
}

func (d *decoderBuilder) newMapDecoder(t reflect.Type) decoderFunc {
	keyType := t.Key()
	itemType := t.Elem()
	itemDecoder := d.typeDecoder(itemType)

	return func(node gjson.Result, value reflect.Value, state *decoderState) (err error) {
		mapValue := reflect.MakeMapWithSize(t, len(node.Map()))

		node.ForEach(func(key, value gjson.Result) bool {
			// It's fine for us to just use `ValueOf` here because the key types will
			// always be primitive types so we don't need to decode it using the standard pattern
			keyValue := reflect.ValueOf(key.Value())
			if !keyValue.IsValid() {
				if err == nil {
					err = fmt.Errorf("apijson: received invalid key type %v", keyValue.String())
				}
				return false
			}
			if keyValue.Type() != keyType {
				if err == nil {
					err = fmt.Errorf("apijson: expected key type %v but got %v", keyType, keyValue.Type())
				}
				return false
			}

			itemValue := reflect.New(itemType).Elem()
			itemerr := itemDecoder(value, itemValue, state)
			if itemerr != nil {
				if err == nil {
					err = itemerr
				}
				return false
			}

			mapValue.SetMapIndex(keyValue, itemValue)
			return true
		})

		if err != nil {
			return err
		}
		value.Set(mapValue)
		return nil
	}
}

func (d *decoderBuilder) newArrayTypeDecoder(t reflect.Type) decoderFunc {
	itemDecoder := d.typeDecoder(t.Elem())

	return func(node gjson.Result, value reflect.Value, state *decoderState) (err error) {
		if !node.IsArray() {
			return fmt.Errorf("apijson: could not deserialize to an array")
		}

		arrayNode := node.Array()

		arrayValue := reflect.MakeSlice(reflect.SliceOf(t.Elem()), len(arrayNode), len(arrayNode))
		for i, itemNode := range arrayNode {
			err = itemDecoder(itemNode, arrayValue.Index(i), state)
			if err != nil {
				return err
			}
		}

		value.Set(arrayValue)
		return nil
	}
}

func (d *decoderBuilder) newStructTypeDecoder(t reflect.Type) decoderFunc {
	// map of json field name to struct field decoders
	decoderFields := map[string]decoderField{}
	anonymousDecoders := []decoderField{}
	extraDecoder := (*decoderField)(nil)
	inlineDecoder := (*decoderField)(nil)

	for i := 0; i < t.NumField(); i++ {
		idx := []int{i}
		field := t.FieldByIndex(idx)
		if !field.IsExported() {
			continue
		}
		// If this is an embedded struct, traverse one level deeper to extract
		// the fields and get their encoders as well.
		if field.Anonymous {
			anonymousDecoders = append(anonymousDecoders, decoderField{
				fn:  d.typeDecoder(field.Type),
				idx: idx[:],
			})
			continue
		}
		// If json tag is not present, then we skip, which is intentionally
		// different behavior from the stdlib.
		ptag, ok := parseJSONStructTag(field)
		if !ok {
			continue
		}
		// We only want to support unexported fields if they're tagged with
		// `extras` because that field shouldn't be part of the public API.
		if ptag.extras {
			extraDecoder = &decoderField{ptag, d.typeDecoder(field.Type.Elem()), idx, field.Name}
			continue
		}
		if ptag.inline {
			inlineDecoder = &decoderField{ptag, d.typeDecoder(field.Type), idx, field.Name}
			continue
		}
		if ptag.metadata {
			continue
		}

		oldFormat := d.dateFormat
		dateFormat, ok := parseFormatStructTag(field)
		if ok {
			switch dateFormat {
			case "date-time":
				d.dateFormat = time.RFC3339
			case "date":
				d.dateFormat = "2006-01-02"
			}
		}
		decoderFields[ptag.name] = decoderField{ptag, d.typeDecoder(field.Type), idx, field.Name}
		d.dateFormat = oldFormat
	}

	return func(node gjson.Result, value reflect.Value, state *decoderState) (err error) {
		if field := value.FieldByName("JSON"); field.IsValid() {
			if raw := field.FieldByName("raw"); raw.IsValid() {
				setUnexportedField(raw, node.Raw)
			}
		}

		for _, decoder := range anonymousDecoders {
			// ignore errors
			decoder.fn(node, value.FieldByIndex(decoder.idx), state)
		}

		if inlineDecoder != nil {
			var meta Field
			dest := value.FieldByIndex(inlineDecoder.idx)
			isValid := false
			if dest.IsValid() && node.Type != gjson.Null {
				err = inlineDecoder.fn(node, dest, state)
				if err == nil {
					isValid = true
				}
			}

			if node.Type == gjson.Null {
				meta = Field{
					raw:    node.Raw,
					status: null,
				}
			} else if !isValid {
				meta = Field{
					raw:    node.Raw,
					status: invalid,
				}
			} else if isValid {
				meta = Field{
					raw:    node.Raw,
					status: valid,
				}
			}
			if metadata := getSubField(value, inlineDecoder.idx, inlineDecoder.goname); metadata.IsValid() {
				metadata.Set(reflect.ValueOf(meta))
			}
			return err
		}

		typedExtraType := reflect.Type(nil)
		typedExtraFields := reflect.Value{}
		if extraDecoder != nil {
			typedExtraType = value.FieldByIndex(extraDecoder.idx).Type()
			typedExtraFields = reflect.MakeMap(typedExtraType)
		}
		untypedExtraFields := map[string]Field{}

		for fieldName, itemNode := range node.Map() {
			df, explicit := decoderFields[fieldName]
			var (
				dest reflect.Value
				fn   decoderFunc
				meta Field
			)
			if explicit {
				fn = df.fn
				dest = value.FieldByIndex(df.idx)
			}
			if !explicit && extraDecoder != nil {
				dest = reflect.New(typedExtraType.Elem()).Elem()
				fn = extraDecoder.fn
			}

			isValid := false
			if dest.IsValid() && itemNode.Type != gjson.Null {
				err = fn(itemNode, dest, state)
				if err == nil {
					isValid = true
				}
			}

			if itemNode.Type == gjson.Null {
				meta = Field{
					raw:    itemNode.Raw,
					status: null,
				}
			} else if !isValid {
				meta = Field{
					raw:    itemNode.Raw,
					status: invalid,
				}
			} else if isValid {
				meta = Field{
					raw:    itemNode.Raw,
					status: valid,
				}
			}

			if explicit {
				if metadata := getSubField(value, df.idx, df.goname); metadata.IsValid() {
					metadata.Set(reflect.ValueOf(meta))
				}
			}
			if !explicit {
				untypedExtraFields[fieldName] = meta
			}
			if !explicit && extraDecoder != nil {
				typedExtraFields.SetMapIndex(reflect.ValueOf(fieldName), dest)
			}
		}

		if extraDecoder != nil && typedExtraFields.Len() > 0 {
			value.FieldByIndex(extraDecoder.idx).Set(typedExtraFields)
		}

		// Set exactness to 'extras' if there are untyped, extra fields.
		if len(untypedExtraFields) > 0 && state.exactness > extras {
			state.exactness = extras
		}

		if metadata := getSubField(value, []int{-1}, "ExtraFields"); metadata.IsValid() && len(untypedExtraFields) > 0 {
			metadata.Set(reflect.ValueOf(untypedExtraFields))
		}
		return nil
	}
}

func (d *decoderBuilder) newPrimitiveTypeDecoder(t reflect.Type) decoderFunc {
	switch t.Kind() {
	case reflect.String:
		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			v.SetString(n.String())
			if guardStrict(state, n.Type != gjson.String) {
				return fmt.Errorf("apijson: failed to parse string strictly")
			}
			// Everything that is not an object can be loosely stringified.
			if n.Type == gjson.JSON {
				return fmt.Errorf("apijson: failed to parse string")
			}
			if guardUnknown(state, v) {
				return fmt.Errorf("apijson: failed string enum validation")
			}
			return nil
		}
	case reflect.Bool:
		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			v.SetBool(n.Bool())
			if guardStrict(state, n.Type != gjson.True && n.Type != gjson.False) {
				return fmt.Errorf("apijson: failed to parse bool strictly")
			}
			// Numbers and strings that are either 'true' or 'false' can be loosely
			// deserialized as bool.
			if n.Type == gjson.String && (n.Raw != "true" && n.Raw != "false") || n.Type == gjson.JSON {
				return fmt.Errorf("apijson: failed to parse bool")
			}
			if guardUnknown(state, v) {
				return fmt.Errorf("apijson: failed bool enum validation")
			}
			return nil
		}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			v.SetInt(n.Int())
			if guardStrict(state, n.Type != gjson.Number || n.Num != float64(int(n.Num))) {
				return fmt.Errorf("apijson: failed to parse int strictly")
			}
			// Numbers, booleans, and strings that maybe look like numbers can be
			// loosely deserialized as numbers.
			if n.Type == gjson.JSON || (n.Type == gjson.String && !canParseAsNumber(n.Str)) {
				return fmt.Errorf("apijson: failed to parse int")
			}
			if guardUnknown(state, v) {
				return fmt.Errorf("apijson: failed int enum validation")
			}
			return nil
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			v.SetUint(n.Uint())
			if guardStrict(state, n.Type != gjson.Number || n.Num != float64(int(n.Num)) || n.Num < 0) {
				return fmt.Errorf("apijson: failed to parse uint strictly")
			}
			// Numbers, booleans, and strings that maybe look like numbers can be
			// loosely deserialized as uint.
			if n.Type == gjson.JSON || (n.Type == gjson.String && !canParseAsNumber(n.Str)) {
				return fmt.Errorf("apijson: failed to parse uint")
			}
			if guardUnknown(state, v) {
				return fmt.Errorf("apijson: failed uint enum validation")
			}
			return nil
		}
	case reflect.Float32, reflect.Float64:
		return func(n gjson.Result, v reflect.Value, state *decoderState) error {
			v.SetFloat(n.Float())
			if guardStrict(state, n.Type != gjson.Number) {
				return fmt.Errorf("apijson: failed to parse float strictly")
			}
			// Numbers, booleans, and strings that maybe look like numbers can be
			// loosely deserialized as floats.
			if n.Type == gjson.JSON || (n.Type == gjson.String && !canParseAsNumber(n.Str)) {
				return fmt.Errorf("apijson: failed to parse float")
			}
			if guardUnknown(state, v) {
				return fmt.Errorf("apijson: failed float enum validation")
			}
			return nil
		}
	default:
		return func(node gjson.Result, v reflect.Value, state *decoderState) error {
			return fmt.Errorf("unknown type received at primitive decoder: %s", t.String())
		}
	}
}

func (d *decoderBuilder) newTimeTypeDecoder(t reflect.Type) decoderFunc {
	format := d.dateFormat
	return func(n gjson.Result, v reflect.Value, state *decoderState) error {
		parsed, err := time.Parse(format, n.Str)
		if err == nil {
			v.Set(reflect.ValueOf(parsed).Convert(t))
			return nil
		}

		if guardStrict(state, true) {
			return err
		}

		layouts := []string{
			"2006-01-02",
			"2006-01-02T15:04:05Z07:00",
			"2006-01-02T15:04:05Z0700",
			"2006-01-02T15:04:05",
			"2006-01-02 15:04:05Z07:00",
			"2006-01-02 15:04:05Z0700",
			"2006-01-02 15:04:05",
		}

		for _, layout := range layouts {
			parsed, err := time.Parse(layout, n.Str)
			if err == nil {
				v.Set(reflect.ValueOf(parsed).Convert(t))
				return nil
			}
		}

		return fmt.Errorf("unable to leniently parse date-time string: %s", n.Str)
	}
}

func setUnexportedField(field reflect.Value, value interface{}) {
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(value))
}

func guardStrict(state *decoderState, cond bool) bool {
	if !cond {
		return false
	}

	if state.strict {
		return true
	}

	state.exactness = loose
	return false
}

func canParseAsNumber(str string) bool {
	_, err := strconv.ParseFloat(str, 64)
	return err == nil
}

func guardUnknown(state *decoderState, v reflect.Value) bool {
	if have, ok := v.Interface().(interface{ IsKnown() bool }); guardStrict(state, ok && !have.IsKnown()) {
		return true
	}
	return false
}
