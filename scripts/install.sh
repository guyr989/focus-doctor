#!/usr/bin/env bash
# Builds the daemon, installs the systemd user service, links the extension and the `focus` CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"

cd "$ROOT" && pnpm -s install && pnpm -s build

mkdir -p ~/.local/share/gnome-shell/extensions ~/.config/systemd/user ~/.local/bin
ln -sfn "$ROOT/packages/gnome-extension/focus-monitor@guyr989" ~/.local/share/gnome-shell/extensions/focus-monitor@guyr989
ln -sfn "$ROOT/packages/daemon/dist/cli.js" ~/.local/bin/focus
chmod +x "$ROOT"/packages/daemon/dist/{cli,main}.js

sed -e "s|@NODE@|$NODE|" -e "s|@ROOT@|$ROOT|" "$ROOT/scripts/focus-monitord.service" > ~/.config/systemd/user/focus-monitord.service
systemctl --user daemon-reload
systemctl --user enable --now focus-monitord

gnome-extensions enable focus-monitor@guyr989 || true
cat <<MSG

Installed. Two things only you can do:
  1. Log out and back in once so GNOME loads the extension (Wayland cannot reload it live).
  2. Then run:  focus doctor
MSG
