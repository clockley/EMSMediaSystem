package main

import "testing"

func TestLinuxPosterDesktopDetectsPlasma(t *testing.T) {
	t.Setenv("KDE_FULL_SESSION", "")
	t.Setenv("XDG_CURRENT_DESKTOP", "KDE")
	t.Setenv("DESKTOP_SESSION", "")
	if got := linuxPosterDesktop(); got != "kde" {
		t.Fatalf("KDE desktop = %q", got)
	}

	t.Setenv("XDG_CURRENT_DESKTOP", "ubuntu:GNOME")
	t.Setenv("DESKTOP_SESSION", "ubuntu")
	if got := linuxPosterDesktop(); got != "gnome" {
		t.Fatalf("GNOME desktop = %q", got)
	}

	t.Setenv("KDE_FULL_SESSION", "true")
	if got := linuxPosterDesktop(); got != "kde" {
		t.Fatalf("KDE_FULL_SESSION desktop = %q", got)
	}
}
