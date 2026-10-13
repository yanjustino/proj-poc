package main

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/logger"
)

func TestSenpaiDebugRaisesWailsLogLevel(t *testing.T) {
	for value, want := range map[string]logger.LogLevel{"": logger.INFO, "0": logger.INFO, "1": logger.DEBUG, "true": logger.DEBUG, " ON ": logger.DEBUG} {
		t.Setenv("SENPAI_DEBUG", value)
		if got := wailsLogLevel(); got != want {
			t.Errorf("SENPAI_DEBUG=%q: nivel %v, esperado %v", value, got, want)
		}
	}
}
