import { Field, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import { UserRole } from '../../../domain/authentication/user-role';

registerEnumType(UserRole, {
  name: 'UserRole',
});

@ObjectType('AuthenticatedUser')
/**
 * Runtime GraphQL object model for the authenticated user.
 *
 * Unlike the domain `AuthenticatedUser` interface, this class and its
 * decorators exist at runtime so NestJS can generate the GraphQL schema.
 */
export class AuthenticatedUserGql {
  @Field(() => ID)
  userId!: string;

  @Field(() => String)
  username!: string;

  @Field(() => String)
  email!: string;

  @Field(() => ID)
  movieProviderId!: string;

  @Field(() => [UserRole])
  roles!: UserRole[];

  @Field(() => [String])
  scopes!: string[];
}
