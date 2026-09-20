#!/usr/bin/env bash
# Builds the daemon, installs the systemd user service, links the extension and the `focus` CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"

cd "$ROOT" && pnpm -s install && pnpm -s build

mkdir -p ~/.local/share/gnome-shell/extensions ~/.config/systemd/user ~/.local/bin
ln -sfn "$ROOT/packages/gnome-extension/focus-doctor@guyr989" ~/.local/share/gnome-shell/extensions/focus-doctor@guyr989
ln -sfn "$ROOT/packages/daemon/dist/cli.js" ~/.local/bin/focus
chmod +x "$ROOT"/packages/daemon/dist/{cli,main}.js

sed -e "s|@NODE@|$NODE|" -e "s|@ROOT@|$ROOT|" "$ROOT/scripts/focus-doctord.service" > ~/.config/systemd/user/focus-doctord.service
systemctl --user daemon-reload
systemctl --user enable focus-doctord >/dev/null && systemctl --user restart focus-doctord

# Add to the enabled list directly: `gnome-extensions enable` fails until the Shell has seen the extension.
gsettings get org.gnome.shell enabled-extensions | grep -q focus-doctor@guyr989 || \
  gsettings set org.gnome.shell enabled-extensions "$(gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, 'focus-doctor@guyr989']/; s/@as \[\]/['focus-doctor@guyr989']/")"
gnome-extensions enable focus-doctor@guyr989 2>/dev/null || true
cat <<MSG

Installed. Two things only you can do:
  1. Log out and back in once so GNOME loads the extension (Wayland cannot reload it live).
  2. Then run:  focus doctor
MSG
