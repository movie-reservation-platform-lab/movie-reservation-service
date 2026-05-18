/**
 * Application-level roles understood by the movie reservation service.
 *
 * External identity-provider roles are mapped into this enum during claims
 * parsing. Unknown external roles are ignored until the application explicitly
 * supports them.
 */
export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  TENANT_ADMIN = 'TENANT_ADMIN',
  SYSTEM = 'SYSTEM',
}
