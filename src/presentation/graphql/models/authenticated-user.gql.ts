import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import { UserRole } from '../../../domain/authentication/user-role';

registerEnumType(UserRole, {
  name: 'UserRole',
  description: 'Application role assigned to the authenticated user.',
});

/**
 * Runtime GraphQL object model for the authenticated user.
 *
 * Unlike the domain `AuthenticatedUser` interface, this class and its
 * decorators exist at runtime so NestJS can generate the GraphQL schema.
 */
@ObjectType('AuthenticatedUser', {
  description: 'Authenticated user and tenant context derived from the request authentication layer.',
})
export class AuthenticatedUserGql {
  @Field(() => ID, {
    description: 'Stable user id from the authentication provider or local profile.',
  })
  userId!: string;

  @Field(() => String, {
    description: 'Human-readable username from the authenticated profile.',
  })
  username!: string;

  @Field(() => String, {
    description: 'Email address from the authenticated profile.',
  })
  email!: string;

  @Field(() => ID, {
    description: 'Movie provider id used as the tenant boundary for movie reservation data.',
  })
  movieProviderId!: string;

  @Field(() => String, {
    nullable: true,
    description: 'Optional human-readable movie provider code from authentication claims.',
  })
  movieProviderCode?: string;

  @Field(() => [UserRole], {
    description: 'Application roles assigned to the authenticated user.',
  })
  roles!: UserRole[];

  @Field(() => [String], {
    description: 'Authorization scopes attached to the authenticated request.',
  })
  scopes!: string[];
}
