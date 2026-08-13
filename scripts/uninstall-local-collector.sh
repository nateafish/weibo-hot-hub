#!/bin/zsh
set -euo pipefail

LABEL=com.nateafish.weibo-hot-hub.local-collector
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/Library/Application Support/weibo-hot-hub"
LOG_DIR="$HOME/Library/Logs/weibo-hot-hub"
DOMAIN_TARGET="gui/$(id -u)/$LABEL"

launchctl bootout "$DOMAIN_TARGET" 2>/dev/null || true
launchctl enable "$DOMAIN_TARGET" 2>/dev/null || true

if [[ "${1:-}" == "--purge" ]]; then
  [[ -f "$TARGET" ]] && mv "$TARGET" "$HOME/.Trash/$LABEL.plist.$(date +%s)"
  [[ -d "$STATE_DIR" ]] && mv "$STATE_DIR" "$HOME/.Trash/weibo-hot-hub-state.$(date +%s)"
  [[ -d "$LOG_DIR" ]] && mv "$LOG_DIR" "$HOME/.Trash/weibo-hot-hub-logs.$(date +%s)"
  print "launchd 配置、专用 Chrome Profile、状态和日志已移到废纸篓，可恢复。"
else
  print "launchd 已卸载，专用 Profile 与日志保留。彻底卸载请加 --purge。"
fi
