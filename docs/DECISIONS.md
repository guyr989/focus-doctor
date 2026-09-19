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

## D6 — CLI lives inside the daemon package
- **Chosen:** `focus` is `packages/daemon/src/cli.ts`, sharing the store and queue code directly.
- **Rejected:** a separate `packages/cli` talking to the daemon over HTTP.
- **Why:** SQLite is the shared state; both processes read it, so no IPC is needed. Halves the package count for the POC.
- **Switch cost:** move the file; if live daemon↔CLI messaging is ever needed, add an HTTP/IPC port then.

## D7 — Timing knobs via environment variables
- **Chosen:** `FOCUS_THRESHOLDS=4,8,12 FOCUS_HEARTBEAT=2 FOCUS_DB=...` override defaults.
- **Why:** Lets the end-to-end smoke test run in 20 s instead of 10 min, and isolates a scratch database.
- **Switch cost:** P5 replaces this with the settings store; env stays as an override.

## D8 — Browser extension posts over HTTP, not a WebSocket
- **Chosen:** MV3 service worker does `fetch POST http://127.0.0.1:47113/tab` on every tab change.
- **Rejected:** persistent WebSocket (MV3 kills idle service workers, so the socket needs keep-alive tricks); native messaging host (snap-packaged Brave/Firefox make it painful); reading Chrome's history DB (locked while open, doesn't know the *active* tab).
- **Why:** Stateless, ~20 lines, fails silently when the daemon is down, no keep-alive logic.
- **Switch cost:** `packages/daemon/src/ingest/browser.ts` implements `TabSource`; `packages/browser-extension/background.js` is the other end.
- **Privacy:** only hostname + page title are sent; the full URL never leaves the browser.

## D9 — Idle detection by polling `GetIdletime` each tick
- **Chosen:** Ask Mutter's IdleMonitor for idle milliseconds on every 30 s heartbeat; over 90 s idle counts as away.
- **Rejected:** `AddIdleWatch` signals (event-driven, but two extra signal handlers and reset bookkeeping for no gain at a 30 s cadence).
- **Switch cost:** `IdleMonitor` port, one method.

## D10 — Browser fields only attach while a browser is focused
- Tab info arrives independently of window focus. The daemon merges the last-known tab into the signal only when the focused window is a browser, so a stale tab can never be blamed while you're in another app.
