import { appendFileSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const immutableGhcrImagePattern = /^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+@sha256:[0-9a-f]{64}$/;
const artifactNamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

/**
 * @typedef {{ ArtifactName: string, Results: unknown }} TrivyReport
 * @typedef {{ Severity: string }} Vulnerability
 * @typedef {{
 *   criticalCount: number,
 *   evidenceArtifactName: string,
 *   highCount: number,
 *   immutableImage: string,
 *   policyResult: string,
 * }} SummaryValues
 */

try {
  const reportPathInput = requireEnvironmentVariable('REPORT_PATH');
  const immutableImage = requireEnvironmentVariable('IMMUTABLE_IMAGE');
  const evidenceArtifactName = requireEnvironmentVariable('EVIDENCE_ARTIFACT_NAME');
  const githubOutput = requireEnvironmentVariable('GITHUB_OUTPUT');
  const githubStepSummary = requireEnvironmentVariable('GITHUB_STEP_SUMMARY');
  const githubWorkspace = requireEnvironmentVariable('GITHUB_WORKSPACE');

  if (!immutableGhcrImagePattern.test(immutableImage)) {
    throw new Error(`Expected image is not an immutable GHCR reference: ${immutableImage}`);
  }

  if (!artifactNamePattern.test(evidenceArtifactName)) {
    throw new Error(`Evidence artifact name contains unsupported characters: ${evidenceArtifactName}`);
  }

  const reportPath = resolveWorkspaceFile(reportPathInput, githubWorkspace);
  const report = readTrivyReport(reportPath);

  if (report.ArtifactName !== immutableImage) {
    throw new Error(
      `Trivy report artifact ${String(report.ArtifactName)} does not match expected image ${immutableImage}`,
    );
  }

  const vulnerabilities = collectVulnerabilities(report.Results);
  const highCount = vulnerabilities.filter((vulnerability) => vulnerability.Severity === 'HIGH').length;
  const criticalCount = vulnerabilities.filter((vulnerability) => vulnerability.Severity === 'CRITICAL').length;
  const policyResult = criticalCount === 0 ? 'passed' : 'failed';

  appendFileSync(
    githubOutput,
    [`high-count=${highCount}`, `critical-count=${criticalCount}`, `policy-result=${policyResult}`, ''].join('\n'),
  );
  appendFileSync(
    githubStepSummary,
    renderSummary({ criticalCount, evidenceArtifactName, highCount, immutableImage, policyResult }),
  );

  if (criticalCount > 0) {
    reportWorkflowError(
      `Provisional container policy failed: ${criticalCount} CRITICAL vulnerability finding(s) detected.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  reportWorkflowError(`Unable to evaluate container vulnerability evidence: ${message}`);
  process.exitCode = 1;
}

/**
 * @param {string} name
 * @returns {string}
 */
function requireEnvironmentVariable(name) {
  const value = process.env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`Required environment variable ${name} is missing.`);
  }

  return value;
}

/**
 * @param {string} pathInput
 * @param {string} workspaceInput
 * @returns {string}
 */
function resolveWorkspaceFile(pathInput, workspaceInput) {
  const workspace = realpathSync(workspaceInput);
  const file = realpathSync(resolve(workspace, pathInput));
  const relativePath = relative(workspace, file);

  if (relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Report path must stay inside the GitHub workspace: ${pathInput}`);
  }

  if (isAbsolute(relativePath)) {
    throw new Error(`Report path must stay inside the GitHub workspace: ${pathInput}`);
  }

  return file;
}

/**
 * @param {string} path
 * @returns {TrivyReport}
 */
function readTrivyReport(path) {
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(path, 'utf8')));

  if (!isRecord(parsed)) {
    throw new Error('Trivy report root must be a JSON object.');
  }

  if (parsed.SchemaVersion !== 2) {
    throw new Error(`Unsupported Trivy report schema version: ${String(parsed.SchemaVersion)}`);
  }

  if (parsed.ArtifactType !== 'container_image') {
    throw new Error(`Trivy report artifact type must be container_image, not ${String(parsed.ArtifactType)}`);
  }

  if (typeof parsed.ArtifactName !== 'string') {
    throw new Error('Trivy report ArtifactName must be a string.');
  }

  return { ArtifactName: parsed.ArtifactName, Results: parsed.Results };
}

/**
 * @param {unknown} resultsValue
 * @returns {Vulnerability[]}
 */
function collectVulnerabilities(resultsValue) {
  if (resultsValue === undefined || resultsValue === null) {
    return [];
  }

  if (!Array.isArray(resultsValue)) {
    throw new Error('Trivy report Results must be an array when present.');
  }

  return resultsValue.flatMap((result, resultIndex) => collectResultVulnerabilities(result, resultIndex));
}

/**
 * @param {unknown} resultValue
 * @param {number} resultIndex
 * @returns {Vulnerability[]}
 */
function collectResultVulnerabilities(resultValue, resultIndex) {
  if (!isRecord(resultValue)) {
    throw new Error(`Trivy result at index ${resultIndex} must be an object.`);
  }

  const vulnerabilities = resultValue.Vulnerabilities;

  if (vulnerabilities === undefined || vulnerabilities === null) {
    return [];
  }

  if (!Array.isArray(vulnerabilities)) {
    throw new Error(`Trivy vulnerabilities at result index ${resultIndex} must be an array.`);
  }

  return vulnerabilities.map((vulnerability, vulnerabilityIndex) =>
    parseVulnerability(vulnerability, resultIndex, vulnerabilityIndex),
  );
}

/**
 * @param {unknown} vulnerabilityValue
 * @param {number} resultIndex
 * @param {number} vulnerabilityIndex
 * @returns {Vulnerability}
 */
function parseVulnerability(vulnerabilityValue, resultIndex, vulnerabilityIndex) {
  if (!isRecord(vulnerabilityValue)) {
    throw new Error(`Trivy vulnerability at result ${resultIndex}, index ${vulnerabilityIndex} must be an object.`);
  }

  if (typeof vulnerabilityValue.Severity !== 'string' || vulnerabilityValue.Severity.length === 0) {
    throw new Error(`Trivy vulnerability at result ${resultIndex}, index ${vulnerabilityIndex} has no severity.`);
  }

  return { Severity: vulnerabilityValue.Severity.toUpperCase() };
}

/**
 * @param {SummaryValues} values
 * @returns {string}
 */
function renderSummary({ criticalCount, evidenceArtifactName, highCount, immutableImage, policyResult }) {
  const highDecision =
    highCount === 0
      ? 'No HIGH findings require an admission decision for this candidate.'
      : 'HIGH findings do not fail this provisional gate, but admission requires explicit, recorded operator approval.';

  return [
    '### Provisional container security evidence',
    '',
    `- Immutable candidate: \`${immutableImage}\``,
    '- Scanner: `Trivy`',
    `- HIGH findings: **${highCount}**`,
    `- CRITICAL findings: **${criticalCount}**`,
    `- Provisional policy: **${policyResult.toUpperCase()}**`,
    `- Downloadable evidence artifact: \`${evidenceArtifactName}\``,
    '',
    highDecision,
    '',
    'This CRITICAL-only control is provisional under [service issue #19](https://github.com/movie-reservation-platform-lab/movie-reservation-service/issues/19) pending the durable [platform policy in `.github#8`](https://github.com/movie-reservation-platform-lab/.github/issues/8).',
    '',
  ].join('\n');
}

/**
 * @param {string} message
 * @returns {void}
 */
function reportWorkflowError(message) {
  const escapedMessage = message.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

  console.error(`::error::${escapedMessage}`);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
