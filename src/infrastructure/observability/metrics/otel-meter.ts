import { metrics } from '@opentelemetry/api';

/**
 * Shared OpenTelemetry meter for application-owned metrics.
 */
export const serviceMeter = metrics.getMeter('movie-reservation-service');
