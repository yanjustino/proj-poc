package mhlbridge

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// newExpiringSessionServer mimics what `mhl serve` does to a swept idle
// session (measured with MHL_SERVE_SESSION_TTL=3s): a 404 with an EMPTY body
// for any request carrying the old Mcp-Session-Id; `initialize` hands out a
// new id.
func newExpiringSessionServer(t *testing.T, liveSession string) (*httptest.Server, *[]string) {
	t.Helper()
	var mu sync.Mutex
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("fake server: decode request: %v", err)
		}
		mu.Lock()
		calls = append(calls, req.Method+"@"+r.Header.Get("Mcp-Session-Id"))
		mu.Unlock()
		if req.Method == "initialize" {
			w.Header().Set("Mcp-Session-Id", liveSession)
		} else if req.Method != "notifications/initialized" && r.Header.Get("Mcp-Session-Id") != liveSession {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(rpcResponse{JSONRPC: "2.0", ID: req.ID, Result: json.RawMessage(`{"tools":[]}`)})
	}))
	t.Cleanup(server.Close)
	return server, &calls
}

func TestExpiredSessionIsReopenedAndTheCallRetriedOnce(t *testing.T) {
	server, calls := newExpiringSessionServer(t, "new-session")
	c := &Client{baseURL: server.URL, http: server.Client(), sessionID: "expired-session"}

	if _, err := c.ToolsList(context.Background()); err != nil {
		t.Fatalf("ToolsList after session expiry: %v", err)
	}
	if c.sessionID != "new-session" {
		t.Fatalf("sessionID = %q, want new-session", c.sessionID)
	}
	got := strings.Join(*calls, " ")
	if !strings.HasPrefix(got, "tools/list@expired-session initialize@") || !strings.HasSuffix(got, "tools/list@new-session") {
		t.Fatalf("unexpected call sequence: %s", got)
	}
}

func TestNonSuccessStatusIsReportedInsteadOfEOF(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	c := &Client{baseURL: server.URL, http: server.Client(), sessionID: "s"}

	_, err := c.ToolsList(context.Background())
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") || strings.Contains(err.Error(), "EOF") {
		t.Fatalf("err = %v, want an HTTP 500 error", err)
	}
}
