# Focus Monitor

A privacy-first focus monitor for GNOME on Linux. It knows which task you're supposed to be on, notices when you drift into something else, and nudges you back — escalating if you keep drifting.

Nothing leaves your machine. No screenshots. The only signals are the title of the window you're using and, optionally, the site name of your active browser tab. The optional AI runs locally through Ollama.

## How it works

```
GNOME Shell extension ──D-Bus──▶ focus-monitord (background daemon)
  reports focused window            rules → cache → local AI → drift timer → escalation
  draws the interventions      ◀──  "show a flash / notification / overlay"
                                        ▲
browser extension ──HTTP (localhost)────┘  site name + page title of the active tab
```

| Piece | What it is |
|---|---|
| `packages/gnome-extension` | Tiny GNOME Shell extension. On Wayland it's the only thing that can see window titles or draw over every window, so it does both. |
| `packages/daemon` | Node/TypeScript background program. Task queue, rules, drift timer, AI cache, settings — all in one SQLite file. Serves a settings page on `127.0.0.1:47113`. |
| `packages/browser-extension` | Chrome/Brave extension that reports the active tab's **hostname + title** (never the URL). |
| `focus` | Command line for everything. |

### The three levels

Drift accumulates while you're off task and is forgiven after a minute back on task.

1. **Flash** (2 min) — an on-screen message that fades out.
2. **Notification** (5 min) — stays until you click *I'm on it*.
3. **Overlay** (10 min) — a modal dialog over everything with: *Back to task*, *Snooze* (5/10/15/30/60 or custom, remembers your last choice), *Save for later* (parks the distraction as a backlog task, synced to Google Tasks if connected), *Make this my task* (promotes it to the top of the queue), *Allow this app today*, *Notifications only today*, *Settings*.

Anything with no matching rule and no AI verdict is treated as on-task. Any AI failure is treated as on-task. The tool never interrupts on a guess.

## Install

```sh
git clone https://github.com/guyr989/focus-monitor && cd focus-monitor
./scripts/install.sh
```

Log out and back in once (Wayland can't load a new extension live). Then:

```sh
focus doctor                                # every line should be ✔
focus task add "Client invoice PDF"         # what you should be doing
focus rule add deny kdenlive                # what counts as drifting
focus rule add --task 1 allow invoice       # what counts as on-task for task #1
focus simulate 3                            # see the overlay right now
focus settings                              # opens the settings page
```

### Optional: local AI for windows the rules don't cover

```sh
curl -fsSL https://ollama.com/install.sh | sh     # needs sudo
ollama pull qwen2.5:3b                           # ~2 GB; qwen2.5:1.5b if it feels slow
focus llm test "Blender Donut Tutorial - YouTube"
```

Verdicts are cached per (task, window title) for a week, so the model is asked only about genuinely new things. `focus config set llm_enabled 0` turns it off.

### Optional: browser tabs

`chrome://extensions` → *Developer mode* → *Load unpacked* → `packages/browser-extension`. Same in Brave.

### Optional: Google Tasks

"Save for later" always writes to the local backlog. To also push into Google Tasks: create an OAuth *Desktop app* client in [Google Cloud Console](https://console.cloud.google.com/apis/credentials) with the Tasks API enabled, save it as `~/.config/focus-monitor/google.json` (`{"client_id": "...", "client_secret": "..."}`), then `focus google login`.

## Everyday commands

```
focus task add|list|promote|done      focus rule add|list      focus snooze <min>
focus config list|get|set             focus cache clear        focus simulate 1|2|3
```

Settings change immediately; the daemon re-reads them on every check (every 30 s by default).

## Development

```sh
pnpm install && pnpm test && pnpm typecheck
dbus-run-session -- gnome-shell --devkit     # nested desktop for extension work
```

Every design choice, the alternatives rejected and what it costs to reverse each: [`docs/DECISIONS.md`](docs/DECISIONS.md).
