# Privacy-first PostHog telemetry

This repository contains an **optional telemetry plane** for CargoIQ.

## Architectural boundary

- Protected/application data stays in the application, database, storage and core audit systems.
- PostHog receives only explicit, allowlisted operational/product events.
- No PostHog autocapture or Session Replay is enabled by this integration.
- No user identity, customer/lead identity, patient identity, document contents, request/response bodies, URLs, prompts or model responses are sent.
- Anonymous events use a random session-scoped opaque ID and set `$process_person_profile=false`.
- Telemetry is non-blocking and best-effort. PostHog outages do not affect product workflows.

## Configuration

Enable telemetry deliberately in the deployment environment:

```text
VITE_POSTHOG_PROJECT_TOKEN=<PostHog project token>
VITE_POSTHOG_HOST=https://<your-configured-posthog-ingest-host>
```

Do not commit the project token or any PostHog private/personal API key to the repository.

Leave these variables unset to keep telemetry disabled.

## Event contract

All events go through `src/lib/telemetry/`:

- `events.ts` — machine-readable allowlist and typed payload contract.
- `sanitizer.ts` — fail-closed property filtering and value checks.
- `index.ts` — non-blocking PostHog transport.

Do not call PostHog directly from application code.

## Testing

Run:

```bash
bun test tests/telemetry.test.ts
```

The tests specifically verify that unknown properties, identifiers and nested application state are discarded.
