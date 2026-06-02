import type { ActorContext } from '../authentication/actor-context';
import { UserRole } from '../../domain/authentication/user-role';
import type { Reservation } from '../../domain/movie-reservations/reservation';
import type { ReservationRequest } from '../../domain/movie-reservations/reservation-request';

/**
 * Placeholder policy service for movie reservation authorization decisions.
 *
 * The first rule is tenant/provider isolation; role, scope, and owner checks
 * are only evaluated after the reservation belongs to the actor's provider.
 *
 * This is just a dummy authorization, we will refactor it later to proper authz
 * solution
 *
 */
export class AuthorizationService {
  canReadReservationRequest(actor: ActorContext, reservationRequest: ReservationRequest): boolean {
    if (actor.movieProviderId !== reservationRequest.movieProviderId) {
      return false;
    }

    if (actor.roles.includes(UserRole.TENANT_ADMIN)) {
      return true;
    }

    if (actor.scopes.includes('reservations:read:tenant')) {
      return true;
    }

    return actor.userId === reservationRequest.requestedByUserId;
  }

  canReadReservation(actor: ActorContext, reservation: Reservation): boolean {
    if (actor.movieProviderId !== reservation.movieProviderId) {
      return false;
    }

    if (actor.roles.includes(UserRole.TENANT_ADMIN)) {
      return true;
    }

    if (actor.scopes.includes('reservations:read:tenant')) {
      return true;
    }

    return actor.userId === reservation.reservedByUserId;
  }
}
