# AI recovery verification, 16 October 2026

## Actual deployed test

At 09:38 SAST, one synthetic PDF was uploaded through the deployed CargoIQ UI. Lovable gateway extracted three claims and two timestamps. The rows persisted after refresh. No provider or billing settings were changed. Live diagnostics reported `Using Lovable gateway`. This proves one working call, not a remaining-credit balance or unlimited access.

At 09:48 SAST, basic patch `19cd251` was verified published: explicit no-AI TXT/CSV buttons and size limits appeared; its live import returned a dedupe result against the previously imported synthetic file.

## Recovery design

- Primary provider selection is unchanged. Existing Lovable gateway remains primary in this deployment.
- `Import text (no AI credits)` never calls an AI provider. TXT/CSV lines are imported as REPORTED with no invented timestamps. Text-based PDF imports preserve page numbers. These are not AI extraction.
- When all enabled AI routes fail, readable text uses the same clearly labelled deterministic import. Scanned/encrypted PDFs with no usable text return a clear transcription/retry message. No provider chain can guarantee every scan or outage will work.
- Limits: 5 MB per document, 500 non-empty text lines, 200,000 text characters. No-AI PDF extraction is limited to 20 pages. Limit failures do not silently truncate.
- Deduplication, human review, original demo contradictions and financial/evidence-pack gates remain intact.

## Optional free AI routes, all OFF by default

No secrets belong in source control. A flag is an administrator's confirmation, not independent proof of an account's billing tier. Verify the account before enabling any route.

1. OpenRouter: `OPENROUTER_API_KEY` and `CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED=true`. Model is fixed to `openrouter/free`; no paid model/plugin fallback. Requests require non-training and zero-retention routing. PDF text extraction is local; no paid OCR plugin is used. If no eligible provider exists, recovery continues rather than weakening privacy.
2. Groq: `GROQ_API_KEY` and `CLAIM_GROQ_FREE_PLAN_CONFIRMED=true` only after verifying the account is currently Free. Model is pinned to `openai/gpt-oss-20b`. PDFs first use local text extraction, not unsupported raw PDF upload. No billing upgrade is performed.
3. Gemini TEST ONLY: `GEMINI_API_KEY`, `CLAIM_GEMINI_TEST_FALLBACK_ENABLED=true`, and `CLAIM_GEMINI_FREE_TIER_CONFIRMED=true`, only for a project without paid billing. The user must also check the per-extraction test-data box. Model is pinned to `gemini-2.5-flash-lite`. Native inline PDFs are supported. Google unpaid terms permit training/human review and prohibit submitting sensitive/confidential/personal information. Disable this route before real customer records. No paid-tier fallbacks or grounded-search add-ons.

NVIDIA hosted free endpoints are trial/prototyping access, not an established free production route. No NVIDIA route is enabled.

## Validation

Strict TypeScript, unit suite and production build passed. Dedicated tests prove no-AI TXT imports invoke no fetch; a simulated 402 imports an actual synthetic PDF's four text lines, with page provenance and no invented timestamps; and Gemini requires every config/consent gate. Local browser UI against synthetic live records confirmed both PDF text recovery and explicit TXT import with a visible non-AI notice. These are not claims of live free-provider validation: keys/configuration were unavailable.

## Unverified operations

Lovable balance, Brenda's account/last access and request failure logs were not available from the demo user's tenant-scoped database access. Auth-admin user lookup returned 403. Visible demo-tenant uploads since 07:58 SAST were only the synthetic QA files. This does not show that Brenda has not signed in, uploaded in another tenant or encountered an error. Current code did not record failed extraction attempts in its success-only audit entry.

## Current vendor sources

- https://docs.lovable.dev/features/ai
- https://docs.lovable.dev/introduction/credits-and-usage
- https://ai.google.dev/gemini-api/terms
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/document-processing
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite
- https://console.groq.com/docs/your-data
- https://console.groq.com/docs/billing-faqs
- https://console.groq.com/docs/models
- https://openrouter.ai/docs/guides/routing/routers/free-router
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://developer.nvidia.com/nim
- https://unpdf.unjs.io
