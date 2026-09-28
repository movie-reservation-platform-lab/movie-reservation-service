export const AUDIT_EVENTBRIDGE_SOURCE = 'movie-platform.reservation-service.audit' as const;
export const AUDIT_EVENTBRIDGE_SOURCES = {
  'movie-reservation-service': AUDIT_EVENTBRIDGE_SOURCE,
  'movie-reservation-agent': 'movie-platform.reservation-agent.audit',
  'movie-recommendation-service': 'movie-platform.recommendation-service.audit',
} as const;
export const AUDIT_EVENTBRIDGE_DETAIL_TYPE = 'ocsf.authentication.v1' as const;
export const AUDIT_EVENTBRIDGE_ENVELOPE_VERSION = '1' as const;
