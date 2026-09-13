package main

import (
	"context"
	"strings"
	"testing"
)

// TestPingMHLEndToEnd exercises the exact bound method the frontend calls:
// startup (spawn mhl, MCP handshake) -> PingMHL (tools/list + WorkItem
// tools/call) -> shutdown (stop the child process). Runs against the real
// mhl binary and the real workflows/ directory — no mocks — because the
// thing worth proving in this Fase 0 spike is that the whole chain works,
// not that our own code calls itself correctly.
func TestPingMHLEndToEnd(t *testing.T) {
	app := NewApp()
	app.startup(context.Background())
	if app.mhl == nil {
		t.Fatal("mhl bridge did not start — see stderr above for why")
	}
	defer app.shutdown(context.Background())

	result := app.PingMHL()
	t.Logf("PingMHL result:\n%s", result)

	// PingMHL's own error paths are prefixed exactly like this (see app.go) —
	// checking for a bare "failed" would also match mhl's own tool
	// descriptions, e.g. "state (queued/working/completed/failed/canceled)".
	if strings.Contains(result, "tools/list failed:") || strings.Contains(result, "tools/call failed:") {
		t.Fatalf("PingMHL reported a failure: %s", result)
	}
	if !strings.Contains(result, `"name":"WorkItem"`) {
		t.Fatalf("expected the WorkItem tool in tools/list output, got: %s", result)
	}
	if !strings.Contains(result, `"projects":[]`) {
		t.Fatalf("expected WorkItem(action:list) to return an empty projects array, got: %s", result)
	}
}
