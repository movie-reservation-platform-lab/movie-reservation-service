# Screening availability — issue #36

## Goal and boundaries

Expose a provider-scoped read model for the booking UI. Physical Seat and
existing catalog fields remain unchanged. No auth changes, holds, migrations,
subscriptions or AWS deployment. Consumer: movie-reservation-web issue #11.

## Current state and decision

The catalog resolver returns auditorium seats without reservation state.
Confirmed reservations already exist in both persistence adapters. A separate
ScreeningAvailabilityReader port and query service keep that storage detail out
of GraphQL. Prefer an additive query over changing Seat semantics or calculating
occupancy in the browser.

## Contract

`screeningAvailability(screeningId: ID!): ScreeningAvailability` returns
screeningId and seats with seatId/available. Unknown and foreign-provider
screenings both return null. No owner or reservation identifiers are disclosed.
Pending requests are not holds. Availability is a snapshot, not a booking
guarantee; confirmation and database conflict checks stay authoritative.

## Implementation

1. Add application read DTO, narrow reader port, and actor-scoped query service.
2. Add in-memory and PostgreSQL readers; scope all reads by provider and screening.
3. Wire adapters through existing DI profiles and add a thin GraphQL resolver.
4. Test availability before/after confirmation, another screening, tenant
   isolation, missing IDs and actual GraphQL serialization. Exercise Postgres.
5. Run npm run check, e2e and build. Deploy API before frontend, only with
   operator approval. Old clients remain compatible; frontend rollback is safe.

## Risks and acceptance

Concurrent changes can stale a snapshot; writes continue to reject conflicts.
In-memory state survives browser reload, not process replacement. No storage
migration is claimed. Authentication middleware remains in force.
Done: backend tests pass and the frontend can reconstruct occupancy after reload.

## Handoff

Implement only this additive query on branch ai/36-screening-availability.
Preserve audit and write paths, document snapshot semantics, and do not deploy.
