import { afterEach, describe, expect, it } from 'vitest';

import { startServiceProcess, type ServiceProcess } from '../../support/service-process';

let service: ServiceProcess | undefined;

afterEach(async () => {
  await service?.stop();
  service = undefined;
});

/**
 * tsx (esbuild) does not emit `design:paramtypes`, so resolvers with arguments carry
 * explicit `@Reflect.metadata(...)` to boot under `npm run dev` (see DEVELOPMENT.md).
 * Other process tests run an SWC build, which does emit it; this test keeps the dev
 * runner covered. Observability stays off to avoid the slow tsx + require-hook path.
 */
describe('tsx development runner', () => {
  it('boots the real entrypoint and serves a GraphQL query with arguments', async () => {
    service = await startServiceProcess({
      runtime: 'tsx',
      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'error',
        ENABLE_GRAPHIQL: 'false',
        COMPOSITION_PROFILE: 'local-fixed-user',
        RESERVATION_WORKER_MODE: 'disabled',
        RESERVATION_FAILURE_INJECTION_MODE: 'disabled',
        RESERVATION_FAILURE_INJECTION_RATE: '0',
        OBSERVABILITY_ENABLED: 'false',
      },
    });

    const graphql = async (query: string, variables: Record<string, unknown> = {}) => {
      const response = await fetch(`${service?.url ?? ''}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { readonly data?: Record<string, unknown>; readonly errors?: unknown[] };
    };

    try {
      const movies = await graphql('{ movies { id } }');
      expect(movies.errors).toBeUndefined();
      const movieId = (movies.data?.movies as readonly { readonly id: string }[] | undefined)?.[0]?.id;
      expect(movieId).toEqual(expect.any(String));

      const screenings = await graphql('query ($movieId: ID) { screenings(movieId: $movieId) { id } }', { movieId });
      expect(screenings.errors).toBeUndefined();
      expect(screenings.data?.screenings).toBeInstanceOf(Array);
    } catch (error) {
      throw new Error(`service output:\n${service.output()}`, { cause: error });
    }
  }, 60_000);
});
