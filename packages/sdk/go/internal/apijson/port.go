package apijson

import (
	"fmt"
	"reflect"
)

// Port copies over values from one struct to another struct.
func Port(from any, to any) error {
	toVal := reflect.ValueOf(to)
	fromVal := reflect.ValueOf(from)

	if toVal.Kind() != reflect.Ptr || toVal.IsNil() {
		return fmt.Errorf("destination must be a non-nil pointer")
	}

	for toVal.Kind() == reflect.Ptr {
		toVal = toVal.Elem()
	}
	toType := toVal.Type()

	for fromVal.Kind() == reflect.Ptr {
		fromVal = fromVal.Elem()
	}
	fromType := fromVal.Type()

	if toType.Kind() != reflect.Struct {
		return fmt.Errorf("destination must be a non-nil pointer to a struct (%v %v)", toType, toType.Kind())
	}

	values := map[string]reflect.Value{}
	fields := map[string]reflect.Value{}

	fromJSON := fromVal.FieldByName("JSON")
	toJSON := toVal.FieldByName("JSON")

	// Iterate through the fields of v and load all the "normal" fields in the struct to the map of
	// string to reflect.Value, as well as their raw .JSON.Foo counterpart indicated by j.
	var getFields func(t reflect.Type, v reflect.Value)
	getFields = func(t reflect.Type, v reflect.Value) {
		j := v.FieldByName("JSON")

		// Recurse into anonymous fields first, since the fields on the object should win over the fields in the
		// embedded object.
		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			if field.Anonymous {
				getFields(field.Type, v.Field(i))
				continue
			}
		}

		for i := 0; i < t.NumField(); i++ {
			field := t.Field(i)
			ptag, ok := parseJSONStructTag(field)
			if !ok || ptag.name == "-" {
				continue
			}
			values[ptag.name] = v.Field(i)
			if j.IsValid() {
				fields[ptag.name] = j.FieldByName(field.Name)
			}
		}
	}
	getFields(fromType, fromVal)

	// Use the values from the previous step to populate the 'to' struct.
	for i := 0; i < toType.NumField(); i++ {
		field := toType.Field(i)
		ptag, ok := parseJSONStructTag(field)
		if !ok {
			continue
		}
		if ptag.name == "-" {
			continue
		}
		if value, ok := values[ptag.name]; ok {
			delete(values, ptag.name)
			if field.Type.Kind() == reflect.Interface {
				toVal.Field(i).Set(value)
			} else {
				switch value.Kind() {
				case reflect.String:
					toVal.Field(i).SetString(value.String())
				case reflect.Bool:
					toVal.Field(i).SetBool(value.Bool())
				case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
					toVal.Field(i).SetInt(value.Int())
				case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
					toVal.Field(i).SetUint(value.Uint())
				case reflect.Float32, reflect.Float64:
					toVal.Field(i).SetFloat(value.Float())
				default:
					toVal.Field(i).Set(value)
				}
			}
		}

		if fromJSONField, ok := fields[ptag.name]; ok {
			if toJSONField := toJSON.FieldByName(field.Name); toJSONField.IsValid() {
				toJSONField.Set(fromJSONField)
			}
		}
	}

	// Finally, copy over the .JSON.raw and .JSON.ExtraFields
	if toJSON.IsValid() {
		if raw := toJSON.FieldByName("raw"); raw.IsValid() {
			setUnexportedField(raw, fromJSON.Interface().(interface{ RawJSON() string }).RawJSON())
		}

		if toExtraFields := toJSON.FieldByName("ExtraFields"); toExtraFields.IsValid() {
			if fromExtraFields := fromJSON.FieldByName("ExtraFields"); fromExtraFields.IsValid() {
				setUnexportedField(toExtraFields, fromExtraFields.Interface())
			}
		}
	}

	return nil
}
