#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if curl --silent --fail --max-time 2 http://127.0.0.1:3210/api/capabilities >/dev/null; then
  open http://127.0.0.1:3210
  exit 0
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -d node_modules ]; then
  npm ci || exit 1
fi
if [ ! -f .next/BUILD_ID ]; then
  npm run build || exit 1
fi
(sleep 2; open http://127.0.0.1:3210) &
exec npm run start
