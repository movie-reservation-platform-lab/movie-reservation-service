import type { ReadinessCheckResult } from '../health.types';

export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<ReadinessCheckResult>;
}
