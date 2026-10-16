package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func decodeAnnotations(t *testing.T, body string) map[string]rawAnnotation {
	t.Helper()
	annotations := map[string]rawAnnotation{}
	if err := json.Unmarshal([]byte(body), &annotations); err != nil {
		t.Fatalf("decode %q: %v", body, err)
	}
	return annotations
}

func TestSetRawAnnotationSavesTrimmedTextAsNotApplied(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md"}, nil)
	body, err := app.SetRawAnnotation("wi_1", "a.md", "  O prazo é D+2.  ")
	if err != nil {
		t.Fatal(err)
	}
	got := decodeAnnotations(t, body)["a.md"]
	if got.Text != "O prazo é D+2." || got.Applied || got.UpdatedAt == "" {
		t.Fatalf("unexpected annotation %+v", got)
	}
}

func TestSetRawAnnotationRejectsMissingSourcesAndTraversal(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md"}, nil)
	for _, name := range []string{"b.md", "../a.md", ".annotations.json", ""} {
		if _, err := app.SetRawAnnotation("wi_1", name, "x"); err == nil {
			t.Fatalf("expected an error for %q", name)
		}
	}
	if _, err := app.SetRawAnnotation("wi_1", "a.md", strings.Repeat("x", maxAnnotationRunes+1)); err == nil {
		t.Fatal("expected an error for an oversized annotation")
	}
}

func TestBlankAnnotationRemovesIt(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md"}, nil)
	if _, err := app.SetRawAnnotation("wi_1", "a.md", "x"); err != nil {
		t.Fatal(err)
	}
	body, err := app.SetRawAnnotation("wi_1", "a.md", "   ")
	if err != nil {
		t.Fatal(err)
	}
	if len(decodeAnnotations(t, body)) != 0 {
		t.Fatalf("expected no annotations, got %s", body)
	}
}

// The ingest reads the annotation, so finishing it applies the annotation;
// editing it afterwards makes it pending again.
func TestIngestAppliesTheAnnotationAndAnEditUnappliesIt(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md"}, nil)
	if _, err := app.SetRawAnnotation("wi_1", "a.md", "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.MarkRawIngested("wi_1", "a.md"); err != nil {
		t.Fatal(err)
	}
	body, _ := app.ListRawAnnotations("wi_1")
	if !decodeAnnotations(t, body)["a.md"].Applied {
		t.Fatalf("expected applied after ingest, got %s", body)
	}
	body, _ = app.SetRawAnnotation("wi_1", "a.md", "y")
	if decodeAnnotations(t, body)["a.md"].Applied {
		t.Fatalf("expected pending after edit, got %s", body)
	}
	body, err := app.MarkRawAnnotationApplied("wi_1", "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if !decodeAnnotations(t, body)["a.md"].Applied {
		t.Fatalf("expected applied after annotate, got %s", body)
	}
}

func TestRemovingASourceDropsItsAnnotationAndResetUnappliesTheRest(t *testing.T) {
	app, _ := rebuildTestApp(t, []string{"a.md", "b.md"}, []string{"a.md", "b.md"})
	for _, name := range []string{"a.md", "b.md"} {
		if _, err := app.SetRawAnnotation("wi_1", name, "x"); err != nil {
			t.Fatal(err)
		}
		if _, err := app.MarkRawAnnotationApplied("wi_1", name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := app.RemoveRawSource("wi_1", "a.md"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.ResetIngestedRaw("wi_1"); err != nil {
		t.Fatal(err)
	}
	body, _ := app.ListRawAnnotations("wi_1")
	got := decodeAnnotations(t, body)
	if _, ok := got["a.md"]; ok || got["b.md"].Applied || got["b.md"].Text != "x" {
		t.Fatalf("unexpected annotations after remove+reset: %s", body)
	}
}
