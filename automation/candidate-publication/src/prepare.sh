#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf '::error::%s\n' "$1" >&2
  exit 1
}

require_environment_variable() {
  local variable_name="$1"

  if [[ -z "${!variable_name:-}" ]]; then
    fail "Required environment variable ${variable_name} is missing."
  fi
}

for variable_name in \
  EXPECTED_REPOSITORY \
  EXPECTED_REF \
  GITHUB_EVENT_NAME \
  GITHUB_REF \
  GITHUB_REPOSITORY \
  GITHUB_RUN_ATTEMPT \
  GITHUB_RUN_ID \
  GITHUB_SERVER_URL \
  GITHUB_SHA \
  GITHUB_OUTPUT; do
  require_environment_variable "${variable_name}"
done

if [[ ! "${EXPECTED_REPOSITORY}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail "Expected repository is not a valid owner/repository value: ${EXPECTED_REPOSITORY}"
fi

if [[ ! "${EXPECTED_REF}" =~ ^refs/heads/[A-Za-z0-9._/-]+$ ]]; then
  fail "Expected ref is not a fully qualified branch ref: ${EXPECTED_REF}"
fi

if [[ "${GITHUB_EVENT_NAME}" != "push" ]]; then
  fail "Container candidates may only be prepared for push events, not ${GITHUB_EVENT_NAME}."
fi

if [[ "${GITHUB_REPOSITORY}" != "${EXPECTED_REPOSITORY}" ]]; then
  fail "Repository ${GITHUB_REPOSITORY} is not the canonical publisher ${EXPECTED_REPOSITORY}."
fi

if [[ "${GITHUB_REF}" != "${EXPECTED_REF}" ]]; then
  fail "Ref ${GITHUB_REF} is not the canonical publication ref ${EXPECTED_REF}."
fi

if [[ ! "${GITHUB_SHA}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  fail "GitHub source revision is not a supported lowercase Git object id: ${GITHUB_SHA}"
fi

if [[ ! "${GITHUB_RUN_ID}" =~ ^[0-9]+$ || ! "${GITHUB_RUN_ATTEMPT}" =~ ^[0-9]+$ ]]; then
  fail "GitHub run id and attempt must both be decimal numbers."
fi

if [[ ! "${GITHUB_SERVER_URL}" =~ ^https://[^[:space:]]+$ ]]; then
  fail "GitHub server URL is not a valid HTTPS URL: ${GITHUB_SERVER_URL}"
fi

remote_ref=""
if ! remote_ref="$(
  git ls-remote --exit-code \
    "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git" \
    "${EXPECTED_REF}"
)"; then
  fail "Unable to resolve ${EXPECTED_REF} from the canonical repository."
fi

current_ref_sha="${remote_ref%%[[:space:]]*}"
if [[ ! "${current_ref_sha}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  fail "Canonical ref resolved to an invalid Git object id: ${current_ref_sha}"
fi

if [[ "${current_ref_sha}" != "${GITHUB_SHA}" ]]; then
  fail "Refusing to publish stale revision ${GITHUB_SHA}; current ${EXPECTED_REF} is ${current_ref_sha}."
fi

registry="ghcr.io"
repository="${GITHUB_REPOSITORY,,}"
image_ref="${registry}/${repository}"
tag="sha-${GITHUB_SHA}-run-${GITHUB_RUN_ID}-attempt-${GITHUB_RUN_ATTEMPT}"
build_ref="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${GITHUB_RUN_ATTEMPT}"

{
  printf 'registry=%s\n' "${registry}"
  printf 'repository=%s\n' "${repository}"
  printf 'image_ref=%s\n' "${image_ref}"
  printf 'tag=%s\n' "${tag}"
  printf 'build_ref=%s\n' "${build_ref}"
} >> "${GITHUB_OUTPUT}"
