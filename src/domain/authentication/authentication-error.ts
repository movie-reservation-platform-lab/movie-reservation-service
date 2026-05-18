/**
 * Error used for authentication failures that should become an unauthenticated
 * response at the transport edge.
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
