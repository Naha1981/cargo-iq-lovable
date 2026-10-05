# CargoIQ × Lot Vulture Edge Adapter

Runs at the customer site beside Lot Vulture.

Required environment:
- LOT_VULTURE_URL
- LOT_VULTURE_API_KEY
- CARGOI_Q_INGEST_URL
- CARGOI_Q_CCTV_SOURCE_ID
- CARGOI_Q_CCTV_INGEST_SECRET

Optional:
- ZONE_MAP_FILE
- STATE_FILE
- SPOOL_DIR
- POLL_SECONDS
- HTTP_TIMEOUT

Setup:
1. Create the CCTV source in CargoIQ.
2. Save the one-time ingest secret.
3. Copy zone-map.example.json to zone-map.json and replace provider IDs.
4. Create a Python 3.11+ virtual environment and install requirements.txt.
5. Run adapter.py under a process supervisor.

The adapter reads Lot Vulture camera/live occupancy endpoints. It emits only state transitions, requests the corresponding source snapshot, signs the payload with HMAC-SHA256, and retries unsent events from a local spool.

CargoIQ hashes the actual uploaded media bytes and stores them in private Supabase Storage.

Do not commit secrets, state files or private zone maps.
