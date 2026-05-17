export interface LivenessResponse {
  readonly status: 'ok';
}

export interface ReadinessCheckResult {
  readonly name: string;
  // TODO: Expand readiness states to include 'not_ready' when real dependency
  //  checks are added.
  readonly status: 'ready';
}

export interface ReadinessResponse {
  readonly status: 'ready';
  readonly checks: readonly ReadinessCheckResult[];
}
