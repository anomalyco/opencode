package apijson

import (
	"reflect"
	"testing"
)

type Metadata struct {
	CreatedAt string `json:"created_at"`
}

// Card is the "combined" type of CardVisa and CardMastercard
type Card struct {
	Processor CardProcessor `json:"processor"`
	Data      any           `json:"data"`
	IsFoo     bool          `json:"is_foo"`
	IsBar     bool          `json:"is_bar"`
	Metadata  Metadata      `json:"metadata"`
	Value     interface{}   `json:"value"`

	JSON cardJSON
}

type cardJSON struct {
	Processor   Field
	Data        Field
	IsFoo       Field
	IsBar       Field
	Metadata    Field
	Value       Field
	ExtraFields map[string]Field
	raw         string
}

func (r cardJSON) RawJSON() string { return r.raw }

type CardProcessor string

// CardVisa
type CardVisa struct {
	Processor CardVisaProcessor `json:"processor"`
	Data      CardVisaData      `json:"data"`
	IsFoo     bool              `json:"is_foo"`
	Metadata  Metadata          `json:"metadata"`
	Value     string            `json:"value"`

	JSON cardVisaJSON
}

type cardVisaJSON struct {
	Processor   Field
	Data        Field
	IsFoo       Field
	Metadata    Field
	Value       Field
	ExtraFields map[string]Field
	raw         string
}

func (r cardVisaJSON) RawJSON() string { return r.raw }

type CardVisaProcessor string

type CardVisaData struct {
	Foo string `json:"foo"`
}

// CardMastercard
type CardMastercard struct {
	Processor CardMastercardProcessor `json:"processor"`
	Data      CardMastercardData      `json:"data"`
	IsBar     bool                    `json:"is_bar"`
	Metadata  Metadata                `json:"metadata"`
	Value     bool                    `json:"value"`

	JSON cardMastercardJSON
}

type cardMastercardJSON struct {
	Processor   Field
	Data        Field
	IsBar       Field
	Metadata    Field
	Value       Field
	ExtraFields map[string]Field
	raw         string
}

func (r cardMastercardJSON) RawJSON() string { return r.raw }

type CardMastercardProcessor string

type CardMastercardData struct {
	Bar int64 `json:"bar"`
}

type CommonFields struct {
	Metadata Metadata `json:"metadata"`
	Value    string   `json:"value"`

	JSON commonFieldsJSON
}

type commonFieldsJSON struct {
	Metadata    Field
	Value       Field
	ExtraFields map[string]Field
	raw         string
}

type CardEmbedded struct {
	CommonFields
	Processor CardVisaProcessor `json:"processor"`
	Data      CardVisaData      `json:"data"`
	IsFoo     bool              `json:"is_foo"`

	JSON cardEmbeddedJSON
}

type cardEmbeddedJSON struct {
	Processor   Field
	Data        Field
	IsFoo       Field
	ExtraFields map[string]Field
	raw         string
}

func (r cardEmbeddedJSON) RawJSON() string { return r.raw }

var portTests = map[string]struct {
	from any
	to   any
}{
	"visa to card": {
		CardVisa{
			Processor: "visa",
			IsFoo:     true,
			Data: CardVisaData{
				Foo: "foo",
			},
			Metadata: Metadata{
				CreatedAt: "Mar 29 2024",
			},
			Value: "value",
			JSON: cardVisaJSON{
				raw:         `{"processor":"visa","is_foo":true,"data":{"foo":"foo"}}`,
				Processor:   Field{raw: `"visa"`, status: valid},
				IsFoo:       Field{raw: `true`, status: valid},
				Data:        Field{raw: `{"foo":"foo"}`, status: valid},
				Value:       Field{raw: `"value"`, status: valid},
				ExtraFields: map[string]Field{"extra": {raw: `"yo"`, status: valid}},
			},
		},
		Card{
			Processor: "visa",
			IsFoo:     true,
			IsBar:     false,
			Data: CardVisaData{
				Foo: "foo",
			},
			Metadata: Metadata{
				CreatedAt: "Mar 29 2024",
			},
			Value: "value",
			JSON: cardJSON{
				raw:         `{"processor":"visa","is_foo":true,"data":{"foo":"foo"}}`,
				Processor:   Field{raw: `"visa"`, status: valid},
				IsFoo:       Field{raw: `true`, status: valid},
				Data:        Field{raw: `{"foo":"foo"}`, status: valid},
				Value:       Field{raw: `"value"`, status: valid},
				ExtraFields: map[string]Field{"extra": {raw: `"yo"`, status: valid}},
			},
		},
	},
	"mastercard to card": {
		CardMastercard{
			Processor: "mastercard",
			IsBar:     true,
			Data: CardMastercardData{
				Bar: 13,
			},
			Value: false,
		},
		Card{
			Processor: "mastercard",
			IsFoo:     false,
			IsBar:     true,
			Data: CardMastercardData{
				Bar: 13,
			},
			Value: false,
		},
	},
	"embedded to card": {
		CardEmbedded{
			CommonFields: CommonFields{
				Metadata: Metadata{
					CreatedAt: "Mar 29 2024",
				},
				Value: "embedded_value",
				JSON: commonFieldsJSON{
					Metadata: Field{raw: `{"created_at":"Mar 29 2024"}`, status: valid},
					Value:    Field{raw: `"embedded_value"`, status: valid},
					raw:      `should not matter`,
				},
			},
			Processor: "visa",
			IsFoo:     true,
			Data: CardVisaData{
				Foo: "embedded_foo",
			},
			JSON: cardEmbeddedJSON{
				raw:       `{"processor":"visa","is_foo":true,"data":{"foo":"embedded_foo"},"metadata":{"created_at":"Mar 29 2024"},"value":"embedded_value"}`,
				Processor: Field{raw: `"visa"`, status: valid},
				IsFoo:     Field{raw: `true`, status: valid},
				Data:      Field{raw: `{"foo":"embedded_foo"}`, status: valid},
			},
		},
		Card{
			Processor: "visa",
			IsFoo:     true,
			IsBar:     false,
			Data: CardVisaData{
				Foo: "embedded_foo",
			},
			Metadata: Metadata{
				CreatedAt: "Mar 29 2024",
			},
			Value: "embedded_value",
			JSON: cardJSON{
				raw:       `{"processor":"visa","is_foo":true,"data":{"foo":"embedded_foo"},"metadata":{"created_at":"Mar 29 2024"},"value":"embedded_value"}`,
				Processor: Field{raw: `"visa"`, status: 0x3},
				IsFoo:     Field{raw: "true", status: 0x3},
				Data:      Field{raw: `{"foo":"embedded_foo"}`, status: 0x3},
				Metadata:  Field{raw: `{"created_at":"Mar 29 2024"}`, status: 0x3},
				Value:     Field{raw: `"embedded_value"`, status: 0x3},
			},
		},
	},
}

func TestPort(t *testing.T) {
	for name, test := range portTests {
		t.Run(name, func(t *testing.T) {
			toVal := reflect.New(reflect.TypeOf(test.to))

			err := Port(test.from, toVal.Interface())
			if err != nil {
				t.Fatalf("port of %v failed with error %v", test.from, err)
			}

			if !reflect.DeepEqual(toVal.Elem().Interface(), test.to) {
				t.Fatalf("expected:\n%+#v\n\nto port to:\n%+#v\n\nbut got:\n%+#v", test.from, test.to, toVal.Elem().Interface())
			}
		})
	}
}
