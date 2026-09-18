package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// A double-clicked .app (the common case, no Terminal in sight) has
	// nowhere visible for log.Printf's default stderr output to go —
	// setupFileLogging makes every run's log land in a real file
	// regardless of how the app was launched, without changing anything
	// for a Terminal-launched run (stderr keeps getting it too).
	if logFile, err := setupFileLogging(); err != nil {
		log.Printf("could not set up file logging: %v", err)
	} else if logFile != nil {
		defer logFile.Close()
	}
	log.Printf("senpai version: %s", currentAppVersion())

	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "senpai-app",
		Width:     1280,
		Height:    832,
		MinWidth:  960,
		MinHeight: 640,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 250, G: 249, B: 246, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		// Hidden-inset title bar (traffic lights floating over the sidebar,
		// no separate title strip/text) — the "traditional" bar the default
		// style produces read out of place next to the reference app's
		// integrated one. macOS-only field; ignored on other platforms,
		// which keep their own native default (C6 — no cross-platform
		// behavior change here, just an opt-in on the one OS that supports
		// this style).
		Mac: &mac.Options{
			TitleBar: mac.TitleBarHiddenInset(),
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
