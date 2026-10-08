package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// agentConfigFile is the agent/model choice the workflows read on every LLM
// call (workflows/shared/agents/agent_config.mh), written in the data dir —
// mhl's own CWD (see mhlbridge.Start). Before it existed the choice only
// reached mhl as environment variables, fixed when the process starts, so
// every model or agent switch restarted mhl (~7s re-validating every
// workflow). The env vars are still passed at startup as the fallback the
// workflows use when this file is missing.
const agentConfigFile = ".senpai-agent.json"

type agentConfig struct {
	Agent        string `json:"agent"`
	DevinModel   string `json:"devin_model"`
	DevinPricing string `json:"devin_pricing"`
	CodexModel   string `json:"codex_model"`
	ClaudeModel  string `json:"claude_model"`
}

func (a *App) currentAgentConfig() agentConfig {
	return agentConfig{
		Agent:        a.agent,
		DevinModel:   a.devinModel,
		DevinPricing: devinPricingJSON(a.devinModel, a.devinCostSummary),
		CodexModel:   a.codexModel,
		ClaudeModel:  a.claudeModel,
	}
}

// writeAgentConfig replaces the file atomically (temp file + rename), so a
// call starting mid-write reads either the old choice or the new one, never
// a truncated JSON.
func writeAgentConfig(dataDir string, cfg agentConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dataDir, agentConfigFile)
	tmp, err := os.CreateTemp(filepath.Dir(path), agentConfigFile+".tmp-*")
	if err != nil {
		return fmt.Errorf("gravar configuracao do agente: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return fmt.Errorf("gravar configuracao do agente: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("gravar configuracao do agente: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("gravar configuracao do agente: %w", err)
	}
	return nil
}

// applyAgentSettings persists the current agent/model fields to
// settings.json and to the file the workflows read, then reports the bridge
// status — the shape every Set* returned back when it reconnected. Nothing
// restarts: the next LLM call already uses the new choice.
func (a *App) applyAgentSettings() (string, error) {
	if err := saveSettings(appSettings{
		Agent: a.agent, DevinModel: a.devinModel, DevinCostSummary: a.devinCostSummary,
		CodexModel: a.codexModel, ClaudeModel: a.claudeModel,
	}); err != nil {
		return "", fmt.Errorf("salvar configuracao: %w", err)
	}
	if err := writeAgentConfig(a.dataDir, a.currentAgentConfig()); err != nil {
		return "", err
	}
	return a.MCPStatus()
}
