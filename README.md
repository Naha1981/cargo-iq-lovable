# CargoIQ

Close the loop on disputed records.

Product page: https://cargoiq.nahalabs.co.za/

## What this repository contains

- Organise source-linked freight evidence, review claims and gaps, and prepare a case for human review.
- The implementation includes case documents, definitions, counts, clocks, financials and evidence-pack surfaces.

## Current limits

- CargoIQ does not create access to withheld records, decide liability or turn an inference into a verified fact.
- Vessel observations do not establish a container movement. Sensor connections, extraction and export must be checked against the configured environment.
- A human resolution records a decision, not proof that its explanation is true.

## Verification

Documentation checked 6 November 2026 against current source, available public pages and recorded test evidence. Source implementation and live acceptance are separate. No new customer data, message, payment or production change was created in this review.

Source references:
- `src/routes/cases.$caseId.documents.tsx`
- `src/routes/cases.$caseId.pack.tsx`
- `docs/DB-OPERATIONS.md`

## Maintaining this repository

See [MAINTAINER.md](MAINTAINER.md) for setup, checks and retained technical notes. Keep credentials in private environment settings, never in this README. Existing licence and copyright files remain unchanged.
