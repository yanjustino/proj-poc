package main

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"senpai-app/mhlbridge"
)

// App struct
type App struct {
	ctx context.Context
	mhl *mhlbridge.Client
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Spike-only path resolution: reach into the sibling workflows/ directory
	// checked out next to app/. Fase 7 replaces this with a vendored/embedded
	// copy resolved relative to the packaged executable (C6) — this is only
	// meant to prove the spawn+MCP-over-HTTP mechanism from Go, not the final
	// packaging story.
	workflowsDir, err := filepath.Abs("../workflows")
	if err != nil {
		log.Printf("mhl bridge: resolve workflows dir: %v", err)
		return
	}

	client, err := mhlbridge.Start(ctx, "mhl", workflowsDir)
	if err != nil {
		log.Printf("mhl bridge: failed to start: %v", err)
		return
	}
	a.mhl = client
	log.Printf("mhl bridge: ready, serving %s", workflowsDir)
}

// shutdown is called when the app is closing. Ends the MCP session and
// terminates the mhl child process — it must not outlive this app.
func (a *App) shutdown(ctx context.Context) {
	if err := a.mhl.Stop(); err != nil {
		log.Printf("mhl bridge: shutdown: %v", err)
	}
}

// PingMHL proves the full chain end to end: frontend -> bound Go method ->
// mhlbridge -> real mhl child process over MCP/HTTP -> back. Calls
// tools/list, then a real WorkItem(action:"list") tools/call. Temporary —
// Fase 5/6 replace this with the real run/status/resume bindings the UI
// actually needs.
func (a *App) PingMHL() string {
	if a.mhl == nil {
		return "mhl bridge is not running (see the app log for why startup failed)"
	}

	tools, err := a.mhl.ToolsList(a.ctx)
	if err != nil {
		return fmt.Sprintf("tools/list failed: %v", err)
	}

	result, err := a.mhl.ToolsCall(a.ctx, "WorkItem", map[string]any{"action": "list"})
	if err != nil {
		return fmt.Sprintf("tools/list ok (%s), but WorkItem tools/call failed: %v", string(tools), err)
	}

	return fmt.Sprintf("tools/list -> %s\nWorkItem(action:list) -> %s", string(tools), string(result))
}
