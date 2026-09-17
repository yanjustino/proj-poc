package main

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"
)

// TestMHLBridge_ConcurrentCallsOnTheSharedSessionNeverFail exercises the
// real production path — mhlbridge.Client, the one this app actually uses,
// not a bare HTTP client — with several requests in flight at once on its
// one shared session, the exact shape tab-artefatos.js's appendPausedPreview
// produces for a paused batch of several ADRs/histórias/diagramas/features.
//
// This is the regression test for a real, measured crash: an isolated repro
// (a bare HTTP client against `mhl serve`, no Senpai code involved) failed
// 9/40 times sharing one Mcp-Session-Id across concurrent requests —
// "decode response: EOF", a "404 Not Found" polling run status — and 0/40
// times giving each concurrent call its own session. Since this Client
// hands out exactly one session for its whole lifetime (every caller — run
// polling, a preview batch, a usage lookup — shares it), the fix is
// Client.postRPC serializing the whole round trip on a mutex, not a
// per-caller workaround; this test proves that holds under the same load
// that used to fail before postRPC had it.
func TestMHLBridge_ConcurrentCallsOnTheSharedSessionNeverFail(t *testing.T) {
	app, _ := newTestApp(t)
	ctx := context.Background()

	const itemsPerRound = 8
	const rounds = 5

	for round := 0; round < rounds; round++ {
		var wg sync.WaitGroup
		errs := make(chan error, itemsPerRound)
		for i := 0; i < itemsPerRound; i++ {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				data := map[string]any{
					"titulo":        fmt.Sprintf("Decisao %d", i),
					"contexto":      "ctx",
					"decisao":       "dec",
					"consequencias": "cons",
					"fontes":        []string{"gap"},
				}
				status, err := app.mhl.RunStart(ctx, "ArtifactPreview", map[string]any{
					"artifact": "decisao",
					"data":     data,
				})
				if err != nil {
					errs <- fmt.Errorf("item %d: RunStart: %w", i, err)
					return
				}
				final, err := app.mhl.PollRunStatus(ctx, status.RunID, 50*time.Millisecond, nil)
				if err != nil {
					errs <- fmt.Errorf("item %d: PollRunStatus: %w", i, err)
					return
				}
				if final.State != "completed" {
					errs <- fmt.Errorf("item %d: state=%s error=%s", i, final.State, final.Error)
				}
			}(i)
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			t.Errorf("round %d: %v", round, err)
		}
	}
}
