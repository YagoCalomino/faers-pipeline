#!/usr/bin/env bash
# Spike D: resources available to Docker and free disk space. Read-only: changes nothing.
# Run on the host from the repo root (Git Bash on Windows, or any POSIX shell):
#   bash scripts/spikes/spike_d_resources.sh
set -uo pipefail

COMPOSE="docker compose --env-file .env -f infra/docker/docker-compose.yml"

echo "== docker info (engine)"
docker info --format 'ServerVersion={{.ServerVersion}} OS={{.OperatingSystem}} Kernel={{.KernelVersion}}
NCPU={{.NCPU}} MemTotal_bytes={{.MemTotal}} Driver={{.Driver}} DockerRootDir={{.DockerRootDir}}'

echo
echo "== docker system df"
docker system df

echo
echo "== seen from inside the airflow-dev container"
$COMPOSE run --rm --no-deps airflow-dev bash -c \
  'echo "nproc=$(nproc)"; grep -E "MemTotal|MemAvailable" /proc/meminfo; df -h /opt/project/data | tail -1'

echo
echo "== host disk free"
df -h . 2>/dev/null | tail -n +1

echo
echo "== Docker Desktop virtual disk (default location on Windows; read-only)"
if [ -n "${LOCALAPPDATA:-}" ] && [ -d "$LOCALAPPDATA/Docker/wsl" ]; then
  find "$LOCALAPPDATA/Docker/wsl" -name '*.vhdx' -exec ls -la {} \; 2>/dev/null
  df -h "$LOCALAPPDATA" | tail -1
else
  echo "not found at the default location"
fi

echo
echo "== WSL config (if any; read-only)"
for f in "${USERPROFILE:-$HOME}/.wslconfig"; do
  if [ -f "$f" ]; then echo "$f:"; cat "$f"; else echo "no $f"; fi
done
