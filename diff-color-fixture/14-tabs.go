package fixture

import "fmt"

// Tab-indented Go: tab-width rendering and tab-only changes.
type Review struct {
	ID       string
	Title    string
	Approved bool
}

func (r Review) Summary() string {
	status := "pending"
	if r.Approved {
		status = "approved"
	}
	return fmt.Sprintf("%s: %s (%s)", r.ID, r.Title, status)
}
