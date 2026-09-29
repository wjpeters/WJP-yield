#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
project_dir="${0:A:h}"
if ! rtk proxy docker info >/dev/null 2>&1; then
  rtk proxy open -a Docker
  for attempt in {1..60}; do
    if rtk proxy docker info >/dev/null 2>&1; then break; fi
    rtk proxy sleep 1
  done
fi
rtk proxy docker compose --project-directory "$project_dir" up --build -d
for attempt in {1..30}; do
  if rtk proxy curl --fail --silent http://localhost:4310/api/health >/dev/null; then
    rtk proxy open http://localhost:4310
    exit 0
  fi
  rtk proxy sleep 1
done
print 'De terminal start nog. Open http://localhost:4310 zodra Docker gereed is.'
