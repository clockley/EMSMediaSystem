//go:build !windows

package main

import (
	"syscall"
	"testing"
)

func makeFifo(t *testing.T, path string) {
	t.Helper()
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Skipf("mkfifo unsupported: %v", err)
	}
}
