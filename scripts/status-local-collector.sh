#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h}
LABEL=com.nateafish.weibo-hot-hub.local-collector
DOMAIN_TARGET="gui/$(id -u)/$LABEL"
UV_CACHE_DIR="$REPO_ROOT/.uv-cache"
export UV_CACHE_DIR

if launchctl print "$DOMAIN_TARGET" >/dev/null 2>&1; then
  print "launchd=loaded"
  launchctl print "$DOMAIN_TARGET" | awk '/state =|pid =|last exit code =/{sub(/^[[:space:]]+/, ""); print}'
else
  print "launchd=not-loaded"
fi

cd "$REPO_ROOT"
PYTHONPATH="$REPO_ROOT/src${PYTHONPATH:+:$PYTHONPATH}" \
  uv run --no-sync python -m weibo_hot_hub.local_collector status --repo-root "$REPO_ROOT"
