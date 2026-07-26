export interface LivenessResponse {
  readonly status: 'ok';
}

export interface ReadinessCheckResult {
  readonly name: string;
  // TODO: Expand readiness states to include 'not_ready' when real dependency
  //  checks are added. Do not make telemetry collection a platform readiness
  //  dependency; collector health needs separate telemetry-path checks and
  //  alerts because the app intentionally fails open when telemetry is down.
  readonly status: 'ready';
}

export interface ReadinessResponse {
  readonly status: 'ready';
  readonly checks: readonly ReadinessCheckResult[];
}
