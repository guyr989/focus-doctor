# Decision log

Every non-obvious choice, the alternatives rejected, and what it costs to switch.
Newest at the bottom. "Seam" = the one file to edit to swap the choice.

## D1 — Read the focused window from a GNOME Shell extension
- **Chosen:** GJS extension exporting `org.guyr.FocusMonitor` on D-Bus.
- **Rejected:** `xdotool`/`wmctrl` (X11 only, blind to Wayland windows); `org.gnome.Shell.Eval` (locked unless unsafe-mode, not supportable); AT-SPI accessibility tree (fragile, per-app opt-in).
- **Why:** Verified on GNOME 50.1: nothing outside the compositor can see window titles.
- **Switch cost:** 1 file — `packages/daemon/src/adapters/gnome.ts` implements `SignalSource`. A KDE/Hyprland/X11 adapter is a sibling file.

## D2 — No Electron / Tauri / Fable
- **Chosen:** Extension draws all UI inside the compositor; a headless Node daemon holds logic.
- **Rejected:** Electron (~300 MB RSS, cannot force always-on-top on Wayland); Tauri (needs Rust toolchain, same Wayland limit); Fable/F# (needs .NET, no capability gain).
- **Why:** The extension is required anyway (D1) and is the only thing that can draw an unescapable overlay.
- **Switch cost:** `Notifier` port in `packages/daemon/src/types.ts`; the GNOME implementation is one file. A web/Electron notifier is a sibling.

## D3 — Extension development in `gnome-shell --devkit`
- **Chosen:** GNOME 50's `--devkit` nested compositor inside `dbus-run-session`.
- **Rejected:** `--nested` (removed in GNOME 50); testing on the live session (Wayland cannot reload the Shell; a bad extension means logout).
- **Gotcha:** The nested desktop has no keyboard focus, so `focus_window` is null until a window is activated programmatically. Not a bug.

## D4 — Rules first, AI later (P1 ships without Ollama)
- **Chosen:** Deterministic allow/deny patterns are the only classifier in the POC.
- **Rejected for now:** Ollama, Gemini, `claude -p`.
- **Why:** Rules already catch the motivating case (video editor open during client work) and cut the POC to the smallest thing that proves the loop.
- **Switch cost:** `Classifier` port; implementations chain, so adding Ollama is a new file plus one line in the chain.

## D5 — `node:sqlite` over better-sqlite3 / Prisma
- **Chosen:** Node's built-in SQLite (experimental flag, stable API surface).
- **Rejected:** better-sqlite3 (native build step on Node 25); Prisma/Drizzle (dependency weight for 6 tables).
- **Switch cost:** `Store` port; all SQL lives in `packages/daemon/src/store/`.
