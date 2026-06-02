import {
  config,
  getCompositionProfileDependencyModes,
  type AuthMode,
  type CompositionProfile,
  type Config,
  type PersistenceMode,
  type ReservationWorkerMode,
} from '../config';
import type { MovieReservationsCompositionOptions } from './movie-reservations/movie-reservations-composition.module';

export interface AppCompositionOverrides {
  readonly compositionProfile?: CompositionProfile;
  readonly authMode?: AuthMode;
  readonly persistenceMode?: PersistenceMode;
  readonly reservationWorkerMode?: ReservationWorkerMode;
}

export interface AppComposition {
  readonly movieReservations: MovieReservationsCompositionOptions;
}

type RuntimeCompositionConfig = Pick<
  Config,
  'COMPOSITION_PROFILE' | 'AUTH_MODE' | 'PERSISTENCE_MODE' | 'RESERVATION_WORKER_MODE'
>;

export function createAppComposition(
  overrides: AppCompositionOverrides = {},
  runtimeConfig: RuntimeCompositionConfig = config,
): AppComposition {
  const profile = overrides.compositionProfile ?? runtimeConfig.COMPOSITION_PROFILE;
  const profileModes = getCompositionProfileDependencyModes(profile);
  const useProfileDefaults = overrides.compositionProfile !== undefined;

  const selectedAuthMode = overrides.authMode ?? (useProfileDefaults ? profileModes.authMode : runtimeConfig.AUTH_MODE);
  const selectedPersistenceMode =
    overrides.persistenceMode ?? (useProfileDefaults ? profileModes.persistenceMode : runtimeConfig.PERSISTENCE_MODE);
  const selectedReservationWorkerMode = overrides.reservationWorkerMode ?? runtimeConfig.RESERVATION_WORKER_MODE;

  return {
    movieReservations: {
      authMode: selectedAuthMode,
      persistenceMode: selectedPersistenceMode,
      reservationWorkerMode: selectedReservationWorkerMode,
    },
  };
}
