package apiquery

import (
	"reflect"
	"strings"
)

const queryStructTag = "query"
const formatStructTag = "format"

type parsedStructTag struct {
	name      string
	omitempty bool
	inline    bool
}

func parseQueryStructTag(field reflect.StructField) (tag parsedStructTag, ok bool) {
	raw, ok := field.Tag.Lookup(queryStructTag)
	if !ok {
		return
	}
	parts := strings.Split(raw, ",")
	if len(parts) == 0 {
		return tag, false
	}
	tag.name = parts[0]
	for _, part := range parts[1:] {
		switch part {
		case "omitempty":
			tag.omitempty = true
		case "inline":
			tag.inline = true
		}
	}
	return
}

func parseFormatStructTag(field reflect.StructField) (format string, ok bool) {
	format, ok = field.Tag.Lookup(formatStructTag)
	return
}
