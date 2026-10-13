#!/usr/bin/env bash
# Schedule `python -m taste.update` daily at 10:00 via a macOS LaunchAgent.
# If the Mac is asleep then, it runs on wake. Log: data/update.log
# Remove with: scripts/install_daily_update.sh --uninstall
set -euo pipefail
LABEL=com.movietaste.update
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--uninstall" ]; then rm -f "$PLIST"; echo "removed $LABEL"; exit 0; fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$DIR/.venv/bin/python</string><string>-m</string><string>taste.update</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict><key>VECLIB_MAXIMUM_THREADS</key><string>4</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$DIR/data/update.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/update.log</string>
  <key>Nice</key><integer>10</integer>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL: daily at 10:00, log at $DIR/data/update.log"
