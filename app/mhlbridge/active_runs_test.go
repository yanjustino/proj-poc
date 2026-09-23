package mhlbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// newFakeRunListServer starts a minimal JSON-RPC server that answers
// mhl_run_list with the given runs (each {"runId": ..., "state": ...}) and
// fails any other tools/call — enough to exercise Client.ActiveRuns without
// a real mhl process, since the shape it depends on (structuredContent:
// {"runs": [...]}) was confirmed against a live `mhl serve mcp --http`
// spike (see ActiveRuns's own doc comment) and won't drift silently.
func newFakeRunListServer(t *testing.T, runs []map[string]any) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("fake server: decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if req.Method == "tools/call" {
			result := map[string]any{
				"isError": false,
				"structuredContent": map[string]any{
					"runs": runs,
				},
			}
			resultJSON, _ := json.Marshal(result)
			_ = json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: resultJSON})
			return
		}
		_ = json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: json.RawMessage(`{}`)})
	}))
	t.Cleanup(server.Close)
	return server
}

func newFakeClient(server *httptest.Server) *Client {
	return &Client{baseURL: server.URL, http: server.Client(), sessionID: "test-session"}
}

func TestActiveRuns_FiltersOutTerminalAndPausedRuns(t *testing.T) {
	server := newFakeRunListServer(t, []map[string]any{
		{"runId": "r1", "state": "working"},
		{"runId": "r2", "state": "queued"},
		{"runId": "r3", "state": "paused"},
		{"runId": "r4", "state": "completed"},
		{"runId": "r5", "state": "failed"},
	})
	client := newFakeClient(server)

	active, err := client.ActiveRuns(context.Background())
	if err != nil {
		t.Fatalf("ActiveRuns: %v", err)
	}

	if len(active) != 2 {
		t.Fatalf("ActiveRuns returned %d runs, want 2 (r1, r2): %+v", len(active), active)
	}
	ids := map[string]bool{active[0].RunID: true, active[1].RunID: true}
	if !ids["r1"] || !ids["r2"] {
		t.Errorf("ActiveRuns = %+v, want exactly r1 and r2 (working/queued) — a paused run waiting on a human isn't actually executing", active)
	}
}

func TestActiveRuns_EmptyWhenNoRunsAreActive(t *testing.T) {
	server := newFakeRunListServer(t, []map[string]any{
		{"runId": "r1", "state": "completed"},
		{"runId": "r2", "state": "paused"},
	})
	client := newFakeClient(server)

	active, err := client.ActiveRuns(context.Background())
	if err != nil {
		t.Fatalf("ActiveRuns: %v", err)
	}
	if len(active) != 0 {
		t.Errorf("ActiveRuns = %+v, want none active", active)
	}
}

func TestActiveRuns_EmptyRunsListIsEmptyNotAnError(t *testing.T) {
	server := newFakeRunListServer(t, []map[string]any{})
	client := newFakeClient(server)

	active, err := client.ActiveRuns(context.Background())
	if err != nil {
		t.Fatalf("ActiveRuns: %v", err)
	}
	if len(active) != 0 {
		t.Errorf("ActiveRuns = %+v, want none", active)
	}
}
