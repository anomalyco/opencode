package apiform

type Marshaler interface {
	MarshalMultipart() ([]byte, string, error)
}
