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
  ARTIFACT_NAME \
  BUILD_REF \
  CANDIDATE_DIGEST \
  CANDIDATE_IMAGE \
  CANDIDATE_REGISTRY \
  CANDIDATE_REPOSITORY \
  CANDIDATE_TAG \
  GITHUB_OUTPUT \
  GITHUB_SERVER_URL \
  GITHUB_STEP_SUMMARY \
  SOURCE_REPOSITORY \
  SOURCE_REVISION; do
  require_environment_variable "${variable_name}"
done

if [[ ! "${ARTIFACT_NAME}" =~ ^[a-z0-9]+([._-][a-z0-9]+)*$ ]]; then
  fail "Artifact name contains unsupported characters: ${ARTIFACT_NAME}"
fi

if [[ "${CANDIDATE_REGISTRY}" != "ghcr.io" ]]; then
  fail "Candidate registry must be ghcr.io, not ${CANDIDATE_REGISTRY}."
fi

if [[ ! "${CANDIDATE_REPOSITORY}" =~ ^[a-z0-9_.-]+/[a-z0-9_.-]+$ ]]; then
  fail "Candidate repository is not a lowercase owner/repository value: ${CANDIDATE_REPOSITORY}"
fi

if [[ "${CANDIDATE_IMAGE}" != "${CANDIDATE_REGISTRY}/${CANDIDATE_REPOSITORY}" ]]; then
  fail "Candidate image does not match its registry and repository components."
fi

if [[ ! "${SOURCE_REPOSITORY}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  fail "Source repository is not a valid owner/repository value: ${SOURCE_REPOSITORY}"
fi

if [[ "${SOURCE_REPOSITORY,,}" != "${CANDIDATE_REPOSITORY}" ]]; then
  fail "Candidate repository does not match the source repository."
fi

if [[ ! "${SOURCE_REVISION}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  fail "Source revision is not a supported lowercase Git object id: ${SOURCE_REVISION}"
fi

if [[ ! "${CANDIDATE_DIGEST}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  fail "Build action returned an invalid image digest: ${CANDIDATE_DIGEST}"
fi

build_ref_prefix="${GITHUB_SERVER_URL}/${SOURCE_REPOSITORY}/actions/runs/"
if [[ "${BUILD_REF}" != "${build_ref_prefix}"* ]]; then
  fail "Build reference does not belong to the source repository: ${BUILD_REF}"
fi

build_ref_suffix="${BUILD_REF#"${build_ref_prefix}"}"
if [[ ! "${build_ref_suffix}" =~ ^([0-9]+)/attempts/([0-9]+)$ ]]; then
  fail "Build reference does not identify an exact run attempt: ${BUILD_REF}"
fi

run_id="${BASH_REMATCH[1]}"
run_attempt="${BASH_REMATCH[2]}"
expected_tag="sha-${SOURCE_REVISION}-run-${run_id}-attempt-${run_attempt}"
if [[ "${CANDIDATE_TAG}" != "${expected_tag}" ]]; then
  fail "Candidate tag does not match the source revision and build attempt."
fi

immutable_candidate="${CANDIDATE_IMAGE}@${CANDIDATE_DIGEST}"

{
  printf '### Published %s candidate\n' "${ARTIFACT_NAME}"
  printf '\n'
  printf -- "- Candidate registry: \`%s\`\n" "${CANDIDATE_REGISTRY}"
  printf -- "- Candidate repository: \`%s\`\n" "${CANDIDATE_REPOSITORY}"
  printf -- "- Candidate tag: \`%s:%s\`\n" "${CANDIDATE_IMAGE}" "${CANDIDATE_TAG}"
  printf -- "- Immutable candidate: \`%s\`\n" "${immutable_candidate}"
  printf -- "- Source repository: \`%s\`\n" "${SOURCE_REPOSITORY}"
  printf -- "- Source revision: \`%s\`\n" "${SOURCE_REVISION}"
  printf -- '- Build reference: %s\n' "${BUILD_REF}"
  printf '\n'
  printf 'After authenticating to GHCR, verify provenance with:\n'
  printf "\`gh attestation verify oci://%s --repo %s\`\n" "${immutable_candidate}" "${SOURCE_REPOSITORY}"
  printf '\n'
  printf 'Only the immutable digest, not the discovery tag, is eligible for downstream admission.\n'
} >> "${GITHUB_STEP_SUMMARY}"

printf 'immutable_candidate=%s\n' "${immutable_candidate}" >> "${GITHUB_OUTPUT}"
