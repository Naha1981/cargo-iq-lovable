# CargoIQ CCTV Evidence Architecture

## Purpose

CargoIQ can use customer-owned CCTV as an independent visual evidence source during freight, terminal, depot, yard, gate and warehouse disputes.

Flow:

Customer CCTV / IP camera
→ Lot Vulture edge CV
→ CargoIQ edge adapter
→ signed HTTPS
→ CargoIQ CCTV observation
→ case timeline
→ evidence pack

## Provider boundary

CargoIQ does not import Lot Vulture source code, inference binaries or model weights.

CargoIQ integrates with a running Lot Vulture deployment through its HTTP API.

This keeps RTSP credentials on-site and keeps CargoIQ provider-neutral.

## Normalized event contract

The edge sends the provider-neutral camera, zone, event, timestamp, timezone, confidence, model/version, processing version, optional ROI, payload and optional source artefact.

Missing confidence is preserved as missing.

## Evidence integrity

For material events CargoIQ stores the actual source frame or clip in private Supabase Storage and hashes the actual stored bytes with SHA-256.

JSON metadata is never substituted for the media hash.

## Authentication

Each source has a tenant-bound ingest secret.

Every request includes:

- source ID
- Unix timestamp
- nonce
- HMAC-SHA256 signature over timestamp + nonce + raw body

CargoIQ rejects stale requests, invalid signatures, unknown sources, disabled sources and replayed nonces.

## Tenant isolation

Every CCTV table has tenant_id and RLS.

Server-side operations also filter by the authenticated tenant. Service-role access is never exposed to the browser.

## Case linkage

Ingested observations begin unlinked. An investigator links a selected observation to a case.

Linkage creates an external_observations record and a timeline_events record while preserving the CCTV observation ID and source provenance.

## Truth model

CCTV can establish that the configured vision source observed a vehicle or other object in a configured zone at a timestamp.

It does not automatically establish vehicle identity, shipment identity, contractual liability or legal liability.

Lighting, camera angle, weather, occlusion and image quality remain explicit limitations.

## Human review

Review states:

- PENDING
- CONFIRMED
- UNCERTAIN
- REJECTED

Reviewer actions are written to audit_log.

A confirmed observation is still an observation; it is not silently converted to a contractual or legal conclusion.

## Deployment

Run Lot Vulture plus the adapter on a Windows or Linux edge machine.

CargoIQ cloud does not ingest RTSP streams.

## Privacy

The first implementation does not add face recognition or automatic license-plate recognition.

Only event-specific media is transmitted to CargoIQ.

## Production retention

The database stores a retention_days setting. A scheduled cleanup job should enforce the policy before broad rollout.
