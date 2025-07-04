package apijson

import (
	"reflect"

	"github.com/tidwall/gjson"
)

type UnionVariant struct {
	TypeFilter         gjson.Type
	DiscriminatorValue interface{}
	Type               reflect.Type
}

var unionRegistry = map[reflect.Type]unionEntry{}
var unionVariants = map[reflect.Type]interface{}{}

type unionEntry struct {
	discriminatorKey string
	variants         []UnionVariant
}

func RegisterUnion(typ reflect.Type, discriminator string, variants ...UnionVariant) {
	unionRegistry[typ] = unionEntry{
		discriminatorKey: discriminator,
		variants:         variants,
	}
	for _, variant := range variants {
		unionVariants[variant.Type] = typ
	}
}

// Useful to wrap a union type to force it to use [apijson.UnmarshalJSON] since you cannot define an
// UnmarshalJSON function on the interface itself.
type UnionUnmarshaler[T any] struct {
	Value T
}

func (c *UnionUnmarshaler[T]) UnmarshalJSON(buf []byte) error {
	return UnmarshalRoot(buf, &c.Value)
}
