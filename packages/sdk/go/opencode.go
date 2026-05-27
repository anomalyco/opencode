// Package opencode provides a Go SDK for the opencode API.
//
// Usage:
//
//	// Create both client and server
//	oc, err := opencode.Create(context.Background(), &opencode.ServerOptions{
//	    Port: 4096,
//	})
//	if err != nil { ... }
//	defer oc.Close()
//
//	sessions, err := oc.Session.List(context.Background())
//
//	// Client-only (connect to existing server)
//	client := opencode.NewClient(&opencode.Config{
//	    BaseURL: "http://localhost:4096",
//	})
package opencode

import "context"

// Opencode bundles a client and (optional) server.
type Opencode struct {
	Client  *Client
	Server  *Server
}

// Create starts an opencode server and returns a connected client.
func Create(ctx context.Context, opts *ServerOptions) (*Opencode, error) {
	server, err := CreateServer(ctx, opts)
	if err != nil {
		return nil, err
	}

	client := NewClient(&Config{
		BaseURL: server.URL,
	})

	return &Opencode{
		Client: client,
		Server: server,
	}, nil
}

// Close stops the server.
func (oc *Opencode) Close() {
	if oc.Server != nil {
		oc.Server.Close()
	}
}
