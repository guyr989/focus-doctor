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

## D11 — Level-3 overlay is a staged GNOME ModalDialog
- **Chosen:** One `ModalDialog` whose button row is swapped between stages (main → snooze presets → custom minutes; main → more). Seven actions never share one row.
- **Rejected:** A custom full-screen St widget (more code, no free keyboard handling, input grab to write by hand); a GTK window (cannot be always-on-top on Wayland).
- **Why:** `ModalDialog` gives an input grab, Escape/Enter handling and the system dialog look for free.
- **Switch cost:** `packages/gnome-extension/focus-monitor@guyr989/ui/overlay.js`; the daemon only sees `OverlayAction` JSON.

## D12 — "Override settings at runtime" = two concrete escape hatches
- **Interpretation:** From the overlay you can (a) allow the current app for the rest of today (a task-scoped `allow` rule with an expiry), or (b) drop to notifications-only for the rest of today (caps the level at 2). Both expire at local midnight so a bad day doesn't silently disable the tool forever.
- **Rejected:** editing thresholds from the overlay (too fiddly under time pressure; that's what the settings menu in P5 is for).
- **Switch cost:** `packages/daemon/src/actions.ts`, one `case`.

## D13 — Promoting a distraction also writes an allow rule
- Without it the new top task would immediately be judged off-task by the same deny rule that triggered the overlay. The rule is scoped to the new task, so the old task keeps its guard.

## D14 — Local model: `qwen2.5:3b` via Ollama, unloaded between calls
- **Chosen:** 3B instruct model, 4-bit, `keep_alive: 10m`, JSON-schema output, temperature 0.
- **Rejected:** 7B+ (needs ~5 GB, this machine has ~4 GB free); vision models (no GPU); Gemini free tier / `claude -p` (data leaves the machine, or costs subscription limits).
- **Why:** The verdict cache makes calls rare, so a 5–15 s cold answer on 4 CPU cores is acceptable. `keep_alive` lets the ~2 GB model leave RAM when idle.
- **Switch cost:** `FOCUS_MODEL=qwen2.5:1.5b` env for a faster model; `packages/daemon/src/classify/ollama.ts` is the seam for any other provider (implement `classify(signal, task) → {verdict, reason}`).

## D15 — The AI can only ever say "on task" by mistake, never "off task"
- Any failure (down, slow, garbage) becomes `unknown`, which the drift engine treats as on task. Timeouts are hard (20 s) and the daemon's tick is serialised so a slow model can't pile up requests. Repeated identical questions are deduplicated in flight and cached for 7 days per (task, signal).
- **Consequence for you:** if Ollama isn't installed, the tool silently degrades to rules-only. `focus doctor` tells you.

## D16 — Settings page is a single HTML file served by the daemon
- **Chosen:** `packages/daemon/src/http/settings.html`, vanilla JS, on the same localhost port as the tab endpoint. The daemon re-reads settings every tick, so CLI, page and overlay all edit one table and take effect within 30 s.
- **Rejected:** Electron/GTK settings window (a whole process for a form); a GNOME extension prefs dialog (only reachable via the Extensions app, can't show tasks).
- **Switch cost:** the page is one file; the JSON API under `/api/` in `http/routes.ts` stays for any other frontend.

## D17 — Google Tasks needs your own OAuth client
- Google doesn't allow shipping a shared client secret in an open-source desktop app, so you create a Desktop OAuth client once and drop it in `~/.config/focus-monitor/google.json`. Sync is an outbox with 5 retries; the local backlog is always authoritative.
- **Rejected:** Google Keep (no consumer API); `gkeepapi` (reverse-engineered, needs a master token).
- **Switch cost:** `sync/googleTasks.ts` implements `push(title, notes)`; a Markdown-file or Todoist sink is a sibling file.

## D18 — Ponytail audit applied (‑54 lines)
- The four desktop ports (`SignalSource`, `Notifier`, `ActionSource`, `IdleMonitor`) became one `Shell` interface in `types.ts`. Still one file to implement for KDE/Hyprland — just one interface instead of four.
- Dropped: `TabSource` wrapper (daemon takes the `LocalServer` directly), live heartbeat rescheduling (`heartbeat_seconds` now needs a daemon restart), `SETTING` constant (string keys typed by `SettingKey`), `max_level`+`max_level_until` (now a single `notify_only_until`), `Settings.numbers()`, the `openSettings` effect flag, and the `pendingRedirect` side-channel in Google login.
- **Switch cost:** each is a mechanical re-split; nothing architectural moved.
