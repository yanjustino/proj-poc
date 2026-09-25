package mhlbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// newFakeRunServer answers every mhl_run_* tool with {runId, state} — the
// state mhl's --state-dir keeps reporting for a run whose process died — and
// records which tools were called.
func newFakeRunServer(t *testing.T, state string) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("fake server: decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		var params struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		raw, _ := json.Marshal(req.Params)
		_ = json.Unmarshal(raw, &params)
		mu.Lock()
		calls = append(calls, params.Name)
		mu.Unlock()
		runID, _ := params.Arguments["runId"].(string)
		if runID == "" {
			runID = "started-here"
		}
		result, _ := json.Marshal(map[string]any{
			"isError":           false,
			"structuredContent": map[string]any{"runId": runID, "state": state},
		})
		_ = json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: result})
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func TestRunStatusGet_ReportsARunFromADeadMhlProcessAsFailed(t *testing.T) {
	server, calls := newFakeRunServer(t, "working")
	client := newFakeClient(server)

	status, err := client.RunStatusGet(context.Background(), "from-a-previous-process")
	if err != nil {
		t.Fatalf("RunStatusGet: %v", err)
	}
	if status.State != "failed" || status.Error != OrphanedRunError {
		t.Fatalf("orphaned run = %+v, want failed with OrphanedRunError", status)
	}
	canceled := false
	for _, name := range *calls {
		if name == "mhl_run_cancel" {
			canceled = true
		}
	}
	if !canceled {
		t.Errorf("orphaned run was not canceled in mhl (calls: %v)", *calls)
	}
}

func TestRunStatusGet_KeepsRunsThisProcessStartedOrResumed(t *testing.T) {
	server, _ := newFakeRunServer(t, "working")
	client := newFakeClient(server)
	ctx := context.Background()

	started, err := client.RunStart(ctx, "Discovery", map[string]any{})
	if err != nil {
		t.Fatalf("RunStart: %v", err)
	}
	if status, _ := client.RunStatusGet(ctx, started.RunID); status.State != "working" {
		t.Errorf("run started by this process = %q, want working", status.State)
	}
	if _, err := client.RunResume(ctx, "paused-earlier", nil); err != nil {
		t.Fatalf("RunResume: %v", err)
	}
	if status, _ := client.RunStatusGet(ctx, "paused-earlier"); status.State != "working" {
		t.Errorf("run resumed by this process = %q, want working", status.State)
	}
}

func TestRunStatusGet_LeavesPausedRunsFromEarlierProcessesAlone(t *testing.T) {
	server, _ := newFakeRunServer(t, "paused")
	client := newFakeClient(server)
	if status, _ := client.RunStatusGet(context.Background(), "draft-from-yesterday"); status.State != "paused" {
		t.Errorf("paused run = %q, want paused (a checkpoint, not an orphan)", status.State)
	}
}
