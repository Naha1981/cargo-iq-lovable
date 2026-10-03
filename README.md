# Cargo Insight Engine

Build CargoIQ — Investigative Evidence & Dispute Intelligence platform. I want it to be professional, clean, sleek, easy to use, and render visuals for evidence.

PRD:
CargoIQ — Investigative Evidence & Dispute Intelligence

Product: CargoIQ
Company: NahaLabs (Pty) Ltd
Repository: Naha1981/cargoiq-qwen
Current branch: main
PRD version: 3.0
Date: 3 October 2026

1. Product Definition
CargoIQ is an investigative evidence platform for freight, port and logistics disputes.
Its job is not to replace a TMS.
Its job is to answer:
What actually happened, what evidence supports it, where do the records disagree, what financial exposure follows from the documented facts, and what can we defensibly present to another party?

CargoIQ combines:
Customer documents + operational records + external observations + geospatial evidence + deterministic commercial rules
into a human-reviewed investigation and evidence pack.

Product promise:
Reconstruct what happened. Prove what can be proven. Expose contradictions. Calculate the money. Package the evidence.

2. Initial Dispute Types
P0:
- Demurrage
- Detention
- Storage
- Truck waiting time
- Accessorial charges
- Carrier overcharges

3. Core Investigation Workflow
Case opened → Documents/records uploaded → Evidence extracted → Claims created → Timeline constructed → Contradictions identified → External observations requested → AIS / satellite / weather / port evidence attached → Commercial rules applied → Financial exposure calculated → Human review → Evidence pack generated → Approved investigation → Recovery / dispute action

4. CargoIQ Evidence Model
Every material assertion must carry provenance.
Evidence classes: CUSTOMER_PRIMARY, CONTRACTUAL, OFFICIAL_PUBLIC, LICENSED_COMMERCIAL, INDEPENDENT_OBSERVATION, DERIVED, INFERRED, DISPUTED, UNKNOWN.
Visually distinguish: Observed, Reported, Derived, Inferred, Disputed.

5. God's Eye View (Geospatial & Timeline Surface)
Interactive visual investigation surface (e.g., Durban Harbour / port terminal):
- Case-linked vessel movements (AIS position & timeline)
- Satellite scenes (Sentinel-1 / Sentinel-2)
- Mapped infrastructure & terminal boundaries
- Temporal alignment of observations against investigation timeline

6. Document Investigation & Contradiction Engine
- Document upload, claim extraction, provenance tagging, page references
- Contradiction detection (e.g., carrier availability timestamp vs terminal release timestamp) with side-by-side human review resolution

7. Deterministic Financial Engine
- Demurrage calculation: start date, release date, free days, daily rate, currency, commercial rules version
- Calculated vs charged amount, potential recovery breakdown

8. Evidence Pack Generator & Human Approval
- Immutable, versioned evidence pack export (v1, v2, v3) with SHA-256 hash, timeline, contradiction logs, audit trail, and approval status.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5d4898c0-b107-4604-a530-da8960775175).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
