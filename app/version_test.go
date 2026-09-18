package main

import "testing"

func TestCurrentAppVersionUsesInjectedReleaseVersion(t *testing.T) {
	previous := buildVersion
	buildVersion = "v1.4.2"
	t.Cleanup(func() { buildVersion = previous })

	if got := currentAppVersion(); got != "v1.4.2" {
		t.Fatalf("currentAppVersion() = %q, want v1.4.2", got)
	}
}
