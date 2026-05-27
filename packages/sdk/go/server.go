package opencode

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// Server represents a running opencode server process.
type Server struct {
	URL   string
	cmd   *exec.Cmd
	close func()
}

// Close stops the opencode server process.
func (s *Server) Close() {
	s.close()
	Stop(s.cmd)
}

var serverURLRe = regexp.MustCompile(`opencode server listening\s+on\s+(https?://\S+)`)

// CreateServer starts an opencode server process and waits for it to be ready.
func CreateServer(ctx context.Context, opts *ServerOptions) (*Server, error) {
	if opts == nil {
		opts = &ServerOptions{}
	}
	if opts.Hostname == "" {
		opts.Hostname = "127.0.0.1"
	}
	if opts.Port == 0 {
		opts.Port = 4096
	}
	if opts.Timeout == 0 {
		opts.Timeout = 5000
	}

	args := []string{
		"serve",
		fmt.Sprintf("--hostname=%s", opts.Hostname),
		fmt.Sprintf("--port=%d", opts.Port),
	}
	if opts.Config != nil {
		configJSON, err := json.Marshal(opts.Config)
		if err != nil {
			return nil, fmt.Errorf("marshal config: %w", err)
		}
		os.Setenv("OPENCODE_CONFIG_CONTENT", string(configJSON))
	}

	cmd := exec.CommandContext(ctx, "opencode", args...)
	cmd.Env = os.Environ()
	if opts.Directory != "" {
		cmd.Dir = opts.Directory
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start opencode: %w", err)
	}

	clear := BindContext(ctx, cmd)

	type result struct {
		url string
		err error
	}
	ch := make(chan result, 1)

	var output strings.Builder

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			output.WriteString(line + "\n")
			if matches := serverURLRe.FindStringSubmatch(line); matches != nil {
				ch <- result{url: matches[1]}
				return
			}
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			output.WriteString(scanner.Text() + "\n")
		}
	}()

	go func() {
		if err := cmd.Wait(); err != nil {
			ch <- result{err: fmt.Errorf("server exited: %w\nServer output: %s", err, output.String())}
		}
	}()

	timeout := time.Duration(opts.Timeout) * time.Millisecond
	select {
	case r := <-ch:
		if r.err != nil {
			clear()
			Stop(cmd)
			return nil, r.err
		}
		return &Server{
			URL:   r.url,
			cmd:   cmd,
			close: clear,
		}, nil
	case <-time.After(timeout):
		clear()
		Stop(cmd)
		return nil, fmt.Errorf("timeout waiting for server to start after %dms", opts.Timeout)
	case <-ctx.Done():
		clear()
		Stop(cmd)
		return nil, ctx.Err()
	}
}

// CreateTui starts an opencode TUI process.
func CreateTui(ctx context.Context, opts *TuiOptions) (*Tui, error) {
	if opts == nil {
		opts = &TuiOptions{}
	}

	var args []string
	if opts.Project != "" {
		args = append(args, fmt.Sprintf("--project=%s", opts.Project))
	}
	if opts.Model != "" {
		args = append(args, fmt.Sprintf("--model=%s", opts.Model))
	}
	if opts.Session != "" {
		args = append(args, fmt.Sprintf("--session=%s", opts.Session))
	}
	if opts.Agent != "" {
		args = append(args, fmt.Sprintf("--agent=%s", opts.Agent))
	}

	cmd := exec.CommandContext(ctx, "opencode", args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start opencode tui: %w", err)
	}

	clear := BindContext(ctx, cmd)

	return &Tui{
		cmd:   cmd,
		close: clear,
	}, nil
}

// Tui represents a running opencode TUI process.
type Tui struct {
	cmd   *exec.Cmd
	close func()
}

// Close stops the TUI process.
func (t *Tui) Close() {
	t.close()
	Stop(t.cmd)
}

// Wait blocks until the TUI process exits.
func (t *Tui) Wait() error {
	return t.cmd.Wait()
}
