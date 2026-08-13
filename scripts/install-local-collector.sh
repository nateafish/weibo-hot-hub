#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
LABEL=com.nateafish.weibo-hot-hub.local-collector
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/weibo-hot-hub"
STATE_DIR="$HOME/Library/Application Support/weibo-hot-hub"
DOMAIN_TARGET="gui/$(id -u)/$LABEL"
UV_CACHE_DIR="$REPO_ROOT/.uv-cache"
export UV_CACHE_DIR

if [[ "$(uname -s)" != Darwin ]]; then
  print -u2 "This installer requires macOS."
  exit 2
fi
if [[ "$(uname -m)" != arm64 ]]; then
  print -u2 "Expected Apple Silicon arm64."
  exit 2
fi
for command in uv gh git plutil; do
  command -v "$command" >/dev/null || { print -u2 "Missing command: $command"; exit 2; }
done
[[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] || {
  print -u2 "Google Chrome is not installed in /Applications."
  exit 2
}
gh auth status >/dev/null
gh auth setup-git

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR" "$STATE_DIR/chrome-profile"
chmod 700 "$LOG_DIR" "$STATE_DIR" "$STATE_DIR/chrome-profile"

cd "$REPO_ROOT"
uv sync --extra test

escape_sed() {
  print -r -- "$1" | sed 's/[&|]/\\&/g'
}
repo_escaped=$(escape_sed "$REPO_ROOT")
runner_escaped=$(escape_sed "$SCRIPT_DIR/local-collector")
log_escaped=$(escape_sed "$LOG_DIR")
sed \
  -e "s|__REPO_ROOT__|$repo_escaped|g" \
  -e "s|__RUNNER__|$runner_escaped|g" \
  -e "s|__LOG_DIR__|$log_escaped|g" \
  "$SCRIPT_DIR/com.nateafish.weibo-hot-hub.local-collector.plist.template" > "$TARGET"
chmod 600 "$TARGET"
plutil -lint "$TARGET"

launchctl bootout "$DOMAIN_TARGET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "$DOMAIN_TARGET"

"$SCRIPT_DIR/local-collector" login
print
print "安装完成。登录两个微博站点后运行："
print "  scripts/local-collector check-login"
print "  scripts/local-collector run-now"
