# Integrated evidence pack activation plan (not approved)

No hosted schema change, production record creation, publication or new push is authorized by this file.

## Safe order

1. Review and approve exact code batch. Deploy code which reads the database's current source object and seals that exact object through the existing atomic persistence RPC. With the existing source function, new packs remain legacy-shaped and exports explicitly say integrated registers were not frozen. Do not call that full feature acceptance.
2. Verify deployed code/source generation before schema activation. Existing historical payloads must remain immutable and readable.
3. Inspect the actual project's backup listing and confirm a pre-change restore point and a supported recovery route. Daily restore loses later changes and affects the whole database; database backups exclude storage. No restore or export without separate authority.
4. Only after explicit schema approval, use the actual project owner's privileged SQL editor for the exact single-transaction proposal. It verifies database ownership, old feature catalog and exact old pack function bodies before changing anything. No fake application user ID is supplied. Final complete catalog must match before commit. Any mismatch aborts; stop and inspect, never rerun blindly or weaken the check.
5. New code reads the newly extended source object on its next pack generation. No publication event is needed for the database transaction itself. App readiness changes atomically with its guards. Check actual authenticated behavior after commit.
6. Only after the bounded synthetic acceptance grant, create case-linked test rows in an existing explicitly synthetic case, generate one new DRAFT pack, read JSON/PDF, and compare frozen provenance/audit/uncertainty. Do not approve a pack, mark money recovered, submit externally, delete customer data or clean up without itemized authority. Prior draft may become SUPERSEDED by normal generation; that must be disclosed in the grant.

## Current activation boundary

The repository SQL is an isolated-engine proposal, NOT a usable production
activation script. It replaces three functions, adds two functions and14triggers.
Actual staging owners/defaultACL differ from the local engine; production needs
its own fresh complete schema/ACL/policy/trigger/function baseline, backup/restore
route and reviewed guarded transaction. Do not replace a hash and call it ready.

Staging proof passed26October2026, as recorded below. No production schema
changes, customer writes, public publication or new push are authorized here.
Full production build remains unverified because local attempts exceeded memory;
no further local retries. An approved exact-batch push can run fresh CI, including
both isolated DB proof modes and the production build. No auto-apply step exists.

Actual staging already grants authenticated SELECT on risk_event_case_links and
other risk tables with RLS. The earlier local role SELECT failure was harness
missing Supabase defaultACL, not a staging grant gap; no grants were widened.
The target-defaultACL isolated mode and actual staging investigator/viewer/foreign
and anonymous readiness checks subsequently passed. Do not infer production
permission state from these staging results.

PDF input2MB and output200page budgets fail explicitly, never silently truncate
integrated records. The fivepage long-record synthetic PDF was pixel-inspected,
including endmarker, withheld caveats, readable audit and together approvalblock.
This is synthetic layout evidence, not client production acceptance.

## Remaining release gates

- Exact code-batch review and named Go/final confirmation before any GitHub push.
- Fresh full CI/build, production target catalog/admin/backup verification.
- Separately approved guarded production activation and bounded deployed
  acceptance, with user-controlled Lovable publication. Old DB source remains
  supported by code-first rollout and explicitly discloses unfrozen registers.
- Original scene conversion/model, analysis-grade aligned imagery, historical
  voice and modeled scenario effects remain separate incomplete requirements.

Sources: https://docs.lovable.dev/features/database and
https://docs.lovable.dev/features/database-backups document the route, not this
project's backup state. Never export authentication tables or password hashes.

## Actual bounded staging proof, 26 October 2026

A first attempt stopped at a negative direct-INSERT probe because its test driver
serialized an already canonical JSON string as JSONB again. The normal canonical
RPC creation succeeded. This was reproduced offline, fixed with text-to-jsonb
parameter casts, and independently reviewed. First restoration needed a reviewed
search-path-only correction, then exact original catalog equality was verified.

The corrected second attempt reused the exact retained19-row fixture. Actual
viewer valid-canonical refusal, direct APPROVED refusal, anonymous/authenticated
readiness behavior, foreign isolation, direct draft tuple contention, source and
tenant try-lock rollback, generation wait/stale-source rejection, fresh source
entity/audit agreement and canonical byte persistence passed. The sole committed
change was the marked finding title and its generated audit. Measured retained
rows20, within35; sole stored pack remains DRAFTv1. No new identities or pack
commits in the second attempt. Mandatory original schema restore passed inside
its transaction and an independent post-read matched the exact original catalog.

This is staging evidence only. Production schema/owner/backup, full production
build, publication and deployed client acceptance remain separate gates. The
repository SQL's local-engine fingerprint is not a production activation script.
Do not apply it to production by replacing a fingerprint until the complete
actual target catalog and permissions are reviewed. The source-first code release
can keep using the old DB source, but exports must disclose registers not frozen.
