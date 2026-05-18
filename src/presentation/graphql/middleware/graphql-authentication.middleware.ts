import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';

import { createActorContext } from '../../../application/authentication/actor-context';
import { AuthenticationService } from '../../../application/authentication/authentication.service';
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
