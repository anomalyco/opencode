package input

import "github.com/charmbracelet/x/ansi"

// PrimaryDeviceAttributesEvent is an event that represents the terminal
// primary device attributes.
type PrimaryDeviceAttributesEvent []int

func parsePrimaryDevAttrs(params ansi.Params) Event {
	// Primary Device Attributes
	da1 := make(PrimaryDeviceAttributesEvent, len(params))
	for i, p := range params {
		if !p.HasMore() {
			da1[i] = p.Param(0)
		}
	}
	return da1
}
