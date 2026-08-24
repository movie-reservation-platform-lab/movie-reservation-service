#!/usr/bin/env bash

set -Eeuo pipefail

readonly local_image='movie-reservation-service:local'
readonly report_relative_path='security-evidence/reservation-service-vulnerabilities.json'
readonly evidence_artifact_name='reservation-service-local-vulnerability-report'
readonly trivy_image='docker.io/aquasec/trivy:0.70.0@sha256:be1190afcb28352bfddc4ddeb71470835d16462af68d310f9f4bca710961a41e'
readonly trivy_cache_volume='movie-reservation-service-trivy-cache'

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)
readonly repository_root
readonly report_path="${repository_root}/${report_relative_path}"
readonly evidence_directory="${repository_root}/security-evidence"

temporary_directory=''
temporary_report=''

cleanup() {
  if [[ -n "${temporary_report}" ]]; then
    rm -f -- "${temporary_report}"
  fi

  if [[ -n "${temporary_directory}" ]]; then
    rm -rf -- "${temporary_directory}"
  fi
}

trap cleanup EXIT

for required_command in docker npm node; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Required command is not available: ${required_command}" >&2
    exit 1
  fi
done

cd -- "${repository_root}"

if ! docker info >/dev/null 2>&1; then
  echo 'Docker is not available. Start the local Docker daemon and try again.' >&2
  exit 1
fi

docker_host=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}

case "${docker_host}" in
  unix://*) docker_socket=${docker_host#unix://} ;;
  *)
    echo "The local security check requires a Unix-socket Docker context; found: ${docker_host}" >&2
    exit 1
    ;;
esac

if [[ ! -S "${docker_socket}" ]]; then
  echo "The active Docker socket does not exist or is not a socket: ${docker_socket}" >&2
  exit 1
fi

mkdir -p -- "${evidence_directory}"
temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/reservation-container-security.XXXXXX")
temporary_report=$(mktemp "${evidence_directory}/.reservation-service-vulnerabilities.XXXXXX")
readonly github_output="${temporary_directory}/github-output"
readonly github_summary="${temporary_directory}/github-summary.md"

: >"${github_output}"
: >"${github_summary}"

echo "Building production image ${local_image} for linux/amd64..."
DOCKER_DEFAULT_PLATFORM=linux/amd64 npm run docker:build

echo "Scanning ${local_image} with digest-pinned Trivy 0.70.0..."
if ! docker run --rm \
  --volume "${docker_socket}:/var/run/docker.sock:ro" \
  --volume "${trivy_cache_volume}:/root/.cache/trivy" \
  "${trivy_image}" image \
  --scanners vuln \
  --vuln-type os,library \
  --format json \
  --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL \
  --ignore-unfixed=false \
  --quiet \
  --exit-code 0 \
  --timeout 5m \
  "${local_image}" >"${temporary_report}"; then
  echo 'Trivy could not produce a complete vulnerability report.' >&2
  exit 1
fi

mv -- "${temporary_report}" "${report_path}"
temporary_report=''

echo 'Applying the repository CRITICAL-only policy...'
set +e
EVIDENCE_ARTIFACT_NAME="${evidence_artifact_name}" \
  EXPECTED_IMAGE="${local_image}" \
  GITHUB_OUTPUT="${github_output}" \
  GITHUB_STEP_SUMMARY="${github_summary}" \
  GITHUB_WORKSPACE="${repository_root}" \
  REPORT_PATH="${report_relative_path}" \
  SUBJECT_KIND='local' \
  node "${repository_root}/automation/container-security/src/evaluate.mjs"
evaluation_status=$?
set -e

if [[ -s "${github_summary}" ]]; then
  echo
  cat -- "${github_summary}"
fi

echo "Detailed report: ${report_relative_path}"
exit "${evaluation_status}"
