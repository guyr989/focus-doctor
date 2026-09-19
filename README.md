# Focus Monitor

A privacy-first focus monitor for GNOME on Linux. It knows which task you're supposed to be on, notices when you drift into something else, and nudges you back — escalating gently if you keep drifting.

Nothing leaves your machine. There are no screenshots. The only signal is the title of the window you're using (and, optionally, the site name of your active browser tab).

## How it works

```
GNOME Shell extension ──D-Bus──▶ focus-monitord (background daemon)
  reports focused window            rules → drift timer → escalation
  draws the interventions      ◀──  "show a flash / overlay"
```

- **`packages/gnome-extension`** — a tiny GNOME Shell extension. It's the only thing on Wayland that can see window titles or draw over every window, so it does both.
- **`packages/daemon`** — a small Node/TypeScript background program. Holds your task queue and rules in a single SQLite file, decides on/off task, counts drift, and asks the extension to intervene.
- **`focus`** — the command line to add tasks and rules and to check health.

## Requirements

- Ubuntu 26.04 / GNOME Shell 50 on Wayland (other GNOME 45+ versions probably work; untested)
- Node 22+ and pnpm

## Install

```sh
git clone https://github.com/guyr989/focus-monitor && cd focus-monitor
./scripts/install.sh
```

Then log out and back in once (Wayland can't load a new extension live), and:

```sh
focus doctor                                # every line should be ✔
focus task add "Client invoice PDF"         # what you should be doing
focus rule add deny kdenlive                # what counts as drifting
focus rule add --task 1 allow invoice       # what counts as on-task for task #1
focus flash "hello"                         # you should see a flash on screen
```

## Rules

A rule is a pattern matched (case-insensitively) against `app | window title`. Wrap it in `/.../` for a regex. `deny` beats `allow`; a rule scoped to a task beats a global one. Anything with no matching rule is treated as on-task — the tool never interrupts on a guess.

Drift accumulates while you're off task and clears after a minute back on task. Interventions fire at 2, 5 and 10 minutes of drift by default.

## Development

```sh
pnpm install
pnpm test          # vitest
pnpm typecheck
```

Extension changes are tested in a nested desktop so a mistake can't lock your real session:

```sh
dbus-run-session -- gnome-shell --devkit
```

Design choices and what it costs to reverse them: [`docs/DECISIONS.md`](docs/DECISIONS.md).
