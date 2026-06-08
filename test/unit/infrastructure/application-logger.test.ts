import { describe, expect, it } from 'vitest';

import { createApplicationLogPayload } from '../../../src/infrastructure/observability/application-logger';
import {
  enrichRequestContextWithGraphqlOperation,
  runWithRequestContext,
  type RequestContext,
} from '../../../src/infrastructure/observability/request-context';

describe('createApplicationLogPayload', () => {
  it('auto-attaches common request context without HTTP-only fields', () => {
    const payload = runWithRequestContext(createRequestContext(), () =>
      createApplicationLogPayload('reservation_request.created', {
        message: 'Reservation request created.',
      }),
    );

    expect(payload.message).toBe('Reservation request created.');
    expect(payload.fields).toMatchObject({
      event: 'reservation_request.created',
      correlation_id: 'booking-correlation-id',
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      user_id: 'local-dev-user',
      movie_provider_code: 'aurora-silver-maple',
    });
    expect(payload.fields).not.toHaveProperty('request_id');
    expect(payload.fields).not.toHaveProperty('aws_x_amzn_trace_id');
    expect(payload.fields).not.toHaveProperty('http_method');
    expect(payload.fields).not.toHaveProperty('http_route');
    expect(payload.fields).not.toHaveProperty('movie_provider_id');
  });

  it('keeps HTTP-only fields when the HTTP boundary passes them explicitly', () => {
    const requestContext = createRequestContext();
    const payload = runWithRequestContext(requestContext, () =>
      createApplicationLogPayload('http.request.finish', {
        http_status_code: 200,
        duration_ms: 12,
        request_id: requestContext.requestId,
        aws_x_amzn_trace_id: requestContext.awsXAmznTraceId,
        http_method: requestContext.method,
        http_route: requestContext.path,
      }),
    );

    expect(payload.fields).toMatchObject({
      event: 'http.request.finish',
      correlation_id: 'booking-correlation-id',
      trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      request_id: 'http-request-id',
      aws_x_amzn_trace_id: 'Root=1-67891233-abcdef012345678912345678',
      http_method: 'POST',
      http_route: '/graphql',
      http_status_code: 200,
      duration_ms: 12,
    });
    expect(payload.fields).not.toHaveProperty('movie_provider_id');
  });

  it('auto-attaches GraphQL operation context after the GraphQL boundary enriches the request context', () => {
    const payload = runWithRequestContext(createRequestContext(), () => {
      enrichRequestContextWithGraphqlOperation({
        operationName: 'RequestReservation',
        operationType: 'mutation',
        businessOperation: 'requestReservation',
      });

      return createApplicationLogPayload('reservation_request.created', {
        message: 'Reservation request created.',
      });
    });

    expect(payload.fields).toMatchObject({
      event: 'reservation_request.created',
      correlation_id: 'booking-correlation-id',
      graphql_operation_name: 'RequestReservation',
      graphql_operation_type: 'mutation',
      business_operation: 'requestReservation',
    });
    expect(payload.fields).not.toHaveProperty('request_id');
    expect(payload.fields).not.toHaveProperty('http_method');
    expect(payload.fields).not.toHaveProperty('http_route');
  });
});

function createRequestContext(): RequestContext {
  return {
    correlationId: 'booking-correlation-id',
    requestId: 'http-request-id',
    traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    awsXAmznTraceId: 'Root=1-67891233-abcdef012345678912345678',
    method: 'POST',
    path: '/graphql',
    userId: 'local-dev-user',
    movieProviderId: '11111111-1111-4111-8111-111111111111',
    movieProviderCode: 'aurora-silver-maple',
  };
}
