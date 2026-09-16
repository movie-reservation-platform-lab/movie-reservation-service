#!/usr/bin/env bash
# Caller-only wrapper. Shared tooling owns scanning and governed policy evaluation.
set -Eeuo pipefail

readonly tooling_revision='388507380ae9bc2b1ac91282ff16f40d4c65fcfc'
repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
readonly repository_root
tooling_directory=${PLATFORM_ACTIONS_DIRECTORY:-"${repository_root}/../movie-platform-actions"}
tooling_directory=$(cd -- "${tooling_directory}" && pwd)

for required_command in git docker node; do
  command -v "${required_command}" >/dev/null 2>&1 || {
    echo "Required command is not available: ${required_command}" >&2
    exit 1
  }
done

actual_revision=$(git -C "${tooling_directory}" rev-parse HEAD)
tooling_changes=$(git -C "${tooling_directory}" status --porcelain --untracked-files=all)
if [[ "${actual_revision}" != "${tooling_revision}" ]] || [[ -n "${tooling_changes}" ]]; then
  echo "Shared tooling must be a clean checkout at ${tooling_revision}; set PLATFORM_ACTIONS_DIRECTORY." >&2
  exit 1
fi
if [[ -z "${GH_TOKEN:-}" ]]; then
  echo 'GH_TOKEN is required for authenticated current-policy lookup.' >&2
  exit 1
fi

cd -- "${repository_root}"
docker build --platform linux/amd64 --target runtime --tag movie-reservation-service:local .
exec node "${tooling_directory}/local-tools/container-security/lib/scan.mjs" \
  movie-reservation-service:local \
  --evidence-version v1alpha3 --component reservation-service \
  --output-dir "${repository_root}/security-evidence/local"
