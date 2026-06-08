export interface ReservationWorkObservabilityContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly traceparent: string;
  readonly tracestate?: string;
}

export interface ReservationWorkObservabilityContextProvider {
  getCurrentContext(): ReservationWorkObservabilityContext | undefined;
}
