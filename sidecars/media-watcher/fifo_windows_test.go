//go:build windows

package main

import "testing"

func makeFifo(t *testing.T, _ string) {
	t.Helper()
	t.Skip("POSIX FIFO test skipped on Windows")
}
