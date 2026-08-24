#!/usr/bin/env bash

set -euo pipefail

# Keep provenance verification independently testable from workflow YAML.

readonly expected_repository='movie-reservation-platform-lab/movie-reservation-service'
readonly expected_ref='refs/heads/main'
readonly expected_signer_workflow='github.com/movie-reservation-platform-lab/movie-reservation-service/.github/workflows/ci.yml'
readonly retained_bundle_path='security-evidence/reservation-service-provenance.json'

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
  CANDIDATE_IMAGE \
  GH_TOKEN \
  GITHUB_WORKSPACE \
  PROVENANCE_BUNDLE_PATH \
  RUNNER_TEMP \
  SOURCE_REVISION; do
  require_environment_variable "${variable_name}"
done

if [[ ! "${SOURCE_REVISION}" =~ ^([0-9a-f]{40}|[0-9a-f]{64})$ ]]; then
  fail "Source revision is not a supported lowercase Git object ID."
fi

if [[ ! "${CANDIDATE_IMAGE}" =~ ^ghcr\.io/movie-reservation-platform-lab/movie-reservation-service@sha256:[0-9a-f]{64}$ ]]; then
  fail "Candidate image is not the canonical digest-pinned GHCR subject."
fi

runner_temp="$(realpath -- "${RUNNER_TEMP}")"
workspace="$(realpath -- "${GITHUB_WORKSPACE}")"

if [[ ! -f "${PROVENANCE_BUNDLE_PATH}" ]]; then
  fail "Provenance bundle is not a regular file."
fi

bundle="$(realpath -- "${PROVENANCE_BUNDLE_PATH}")"

case "${bundle}" in
  "${runner_temp}"/*) ;;
  *) fail 'Provenance bundle must be located inside RUNNER_TEMP.' ;;
esac

evidence_directory="${workspace}/security-evidence"
mkdir -p -- "${evidence_directory}"
evidence_directory="$(realpath -- "${evidence_directory}")"

case "${evidence_directory}" in
  "${workspace}"/*) ;;
  *) fail 'Security evidence directory must stay inside GITHUB_WORKSPACE.' ;;
esac

retained_bundle="${workspace}/${retained_bundle_path}"
if [[ -e "${retained_bundle}" || -L "${retained_bundle}" ]]; then
  fail 'Retained provenance bundle path must not already exist.'
fi

cleanup_unverified_bundle() {
  rm -f -- "${retained_bundle}"
}

trap cleanup_unverified_bundle EXIT
install -m 0600 -- "${bundle}" "${retained_bundle}"

gh attestation verify "oci://${CANDIDATE_IMAGE}" \
  --repo "${expected_repository}" \
  --bundle "${retained_bundle}" \
  --signer-workflow "${expected_signer_workflow}" \
  --source-ref "${expected_ref}" \
  --source-digest "${SOURCE_REVISION}" \
  --predicate-type 'https://slsa.dev/provenance/v1' \
  --cert-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --deny-self-hosted-runners \
  --format json >/dev/null

trap - EXIT
