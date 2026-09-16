# Evidence contract ownership

Current publication uses shared `ComponentCandidateEvidence v1alpha3`.
`movie-platform-actions/contracts/` owns its schema and policy definitions;
the service consumes the immutable revision in `.github/workflows/ci.yml`.
Environments owns independent verification and admission, not this producer.

## Historical v1 contract

`component-candidate-evidence-v1alpha1.schema.json` is retained unchanged as
the published historical contract. It is not the schema for new publications.
The service-owned generator, emitter, publication actions and provisional
evaluator were retired after successful v3 publication and admission.
Do not regenerate this schema from the current shared contract or reinterpret
old evidence as v3. Historical fixtures/readers remain with environments.

For implementation archaeology or an explicitly reviewed rollback, use Git
history at service adoption commit `12b6fc488296a994f9c9b9e5bc3554819e5b1ead`.
Restoring old source alone does not authorize publication or change admission
policy. No old executable is retained as an automatic failure fallback.

## Current trust boundaries

The service retains its workflow/job, image, source and run/attempt identity.
Shared tooling emits and attests the four-file package, verifies exact-subject
provenance and evaluates governed vulnerability policy. Environments verifies
original bytes and independently evaluates findings against current policy.
A structurally valid document, old approval or cached receipt is not a fresh
admission decision. See [development guidance](../DEVELOPMENT.md#shared-v1alpha3-security-evidence).
