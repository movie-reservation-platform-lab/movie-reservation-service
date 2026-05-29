import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';

import { createActorContext } from '../../../application/authentication/actor-context';
import { AuthenticationService } from '../../../application/authentication/authentication.service';
import { config } from '../../../config';
import { AuthenticationError } from '../../../domain/authentication/authentication-error';
import { extractBearerToken } from '../bearer-token';
import type { GraphqlHttpRequest } from '../graphql-context';

interface UnauthorizedResponse {
  status(statusCode: number): {
    json(body: unknown): void;
  };
}

@Injectable()
/**
 * Authenticates GraphQL HTTP requests and stores identity on the request.
 *
 * The middleware is a transport adapter: it extracts the bearer token, delegates
 * authentication to the application service, and attaches both the full
 * authenticated user and smaller actor context for Apollo context creation.
 *
 * When GraphiQL is enabled, the initial HTML landing page may be served without
 * authentication. GraphQL operations still go through this middleware and must
 * authenticate before resolver execution.
 *
 * Only HTTP GraphQL requests are handled here. WebSocket/subscription
 * authentication is not supported yet and should use a separate transport path
 * when it is added.
 */
export class GraphqlAuthenticationMiddleware implements NestMiddleware {
  constructor(
    @Inject(AuthenticationService)
    private readonly authenticationService: AuthenticationService,
  ) {}

  async use(
    req: GraphqlHttpRequest,
    res: UnauthorizedResponse,
    next: () => void,
  ): Promise<void> {
    if (config.ENABLE_GRAPHIQL && isGraphqlLandingPageRequest(req)) {
      next();
      return;
    }

    try {
      const token = extractBearerToken(req.headers);
      const authenticatedUser =
        await this.authenticationService.authenticateJwtToken(token);
      req.authenticatedUser = authenticatedUser;
      req.actor = createActorContext(authenticatedUser);
      next();
    } catch (error) {
      if (error instanceof AuthenticationError) {
        res.status(401).json({
          statusCode: 401,
          message: 'Unauthenticated',
        });
        return;
      }

      throw error;
    }
  }
}

/**
 * The unauthenticated GraphiQL landing-page request is detected from the HTTP
 * method and accepted content types.
 */
function isGraphqlLandingPageRequest(req: GraphqlHttpRequest): boolean {
  if (req.method !== 'GET') {
    return false;
  }

  const acceptedContentTypes = readHeaderValues(req.headers.accept);

  return acceptedContentTypes.some((contentType) =>
    contentType.includes('text/html'),
  );
}

/**
 * A single header value or multi-value header is normalized into a readonly
 * list for simple membership checks.
 */
function readHeaderValues(
  headerValue: string | readonly string[] | undefined,
): readonly string[] {
  if (headerValue === undefined) {
    return [];
  }

  if (typeof headerValue === 'string') {
    return [headerValue];
  }

  return headerValue;
}
