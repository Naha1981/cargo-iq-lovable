#!/usr/bin/env python3
"""CargoIQ edge adapter for a customer-operated Lot Vulture instance."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import pathlib
import time
from datetime import datetime, timezone
from typing import Any

import requests

LOT_VULTURE_URL = os.environ["LOT_VULTURE_URL"].rstrip("/")
LOT_VULTURE_API_KEY = os.environ["LOT_VULTURE_API_KEY"]
CARGOI_Q_INGEST_URL = os.environ["CARGOI_Q_INGEST_URL"]
CARGOI_Q_CCTV_SOURCE_ID = os.environ["CARGOI_Q_CCTV_SOURCE_ID"]
CARGOI_Q_CCTV_INGEST_SECRET = os.environ["CARGOI_Q_CCTV_INGEST_SECRET"]
ZONE_MAP_FILE = pathlib.Path(os.getenv("ZONE_MAP_FILE", "zone-map.json"))
STATE_FILE = pathlib.Path(os.getenv("STATE_FILE", "state.json"))
SPOOL_DIR = pathlib.Path(os.getenv("SPOOL_DIR", "spool"))
POLL_SECONDS = float(os.getenv("POLL_SECONDS", "2"))
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "10"))

SESSION = requests.Session()
SESSION.headers.update({"X-API-Key": LOT_VULTURE_API_KEY, "Accept": "application/json"})

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def base64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")

def load_json(path: pathlib.Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))

def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temp.replace(STATE_FILE)

def lotvulture_get(path: str, **params: Any) -> Any:
    response = SESSION.get(f"{LOT_VULTURE_URL}{path}", params=params, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    return response.json()

def lotvulture_get_bytes(path: str, **params: Any) -> bytes:
    response = SESSION.get(f"{LOT_VULTURE_URL}{path}", params=params, timeout=HTTP_TIMEOUT)
    response.raise_for_status()
    return response.content

def sign_event(raw_body: bytes, nonce: str, timestamp: str) -> str:
    message = f"{timestamp}.{nonce}.".encode("utf-8") + raw_body
    digest = hmac.new(CARGOI_Q_CCTV_INGEST_SECRET.encode("utf-8"), message, hashlib.sha256).digest()
    return base64url(digest)

def camera_list() -> list[dict[str, Any]]:
    rows = lotvulture_get("/api/cameras")
    return rows if isinstance(rows, list) else rows.get("data", [])

def live_camera(camera_id: int) -> dict[str, Any]:
    body = lotvulture_get(f"/api/live/{camera_id}")
    return body if isinstance(body, dict) else {}

def camera_snapshot(camera_id: int, scan_id: Any) -> bytes:
    return lotvulture_get_bytes(f"/api/cameras/{camera_id}/snapshot", v=scan_id or "")

def normalize_spaces(body: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("spaces", "occupancies", "results"):
        if isinstance(body.get(key), list):
            return body[key]
    return []

def map_zone(zone_map: dict[str, Any], camera_id: int, space_id: Any) -> dict[str, Any]:
    return zone_map.get(f"{camera_id}:{space_id}", {
        "code": f"CAMERA-{camera_id}-SPACE-{space_id}",
        "type": "CUSTOM",
        "semantic_purpose": "Observed CCTV zone",
    })

def spool_payload(event_id: str, payload: dict[str, Any]) -> None:
    SPOOL_DIR.mkdir(parents=True, exist_ok=True)
    safe = hashlib.sha256(event_id.encode("utf-8")).hexdigest()
    (SPOOL_DIR / f"{safe}.json").write_text(json.dumps(payload), encoding="utf-8")

def send_payload(payload: dict[str, Any]) -> bool:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = base64url(os.urandom(18))
    headers = {
        "Content-Type": "application/json",
        "X-CargoIQ-Source-ID": CARGOI_Q_CCTV_SOURCE_ID,
        "X-CargoIQ-Timestamp": timestamp,
        "X-CargoIQ-Nonce": nonce,
        "X-CargoIQ-Signature": sign_event(raw, nonce, timestamp),
    }
    try:
        response = requests.post(CARGOI_Q_INGEST_URL, data=raw, headers=headers, timeout=HTTP_TIMEOUT)
        if response.status_code in (200, 201, 409):
            return True
        print(f"CargoIQ ingest failed: {response.status_code} {response.text[:300]}")
    except requests.RequestException as exc:
        print(f"CargoIQ ingest unavailable: {exc}")
    return False

def replay_spool() -> None:
    if not SPOOL_DIR.exists():
        return
    for path in sorted(SPOOL_DIR.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if send_payload(payload):
                path.unlink()
        except Exception as exc:
            print(f"spool replay failed for {path.name}: {exc}")

def emit_event(camera: dict[str, Any], space: dict[str, Any], occupied: bool, scan_id: Any, zone: dict[str, Any], model_version: str | None) -> None:
    camera_id = int(camera["id"])
    space_id = space.get("id", space.get("space_id"))
    event_type = "ZONE_OCCUPIED" if occupied else "ZONE_CLEARED"
    event_id = f"{camera_id}:{space_id}:{scan_id}:{event_type}"
    confidence = space.get("confidence")
    payload: dict[str, Any] = {
        "event_id": event_id,
        "camera": {
            "provider_id": str(camera_id),
            "name": camera.get("name"),
            "manufacturer": camera.get("manufacturer"),
            "stream_type": camera.get("source_type"),
            "installation_location": camera.get("location"),
            "timezone": camera.get("timezone", "UTC"),
            "latitude": camera.get("latitude"),
            "longitude": camera.get("longitude"),
        },
        "zone": {
            "code": zone["code"],
            "type": zone.get("type", "CUSTOM"),
            "semantic_purpose": zone.get("semantic_purpose"),
            "provider_id": str(space_id),
        },
        "event_type": event_type,
        "detected_class": "vehicle",
        "observed_at": now_iso(),
        "confidence": float(confidence) if confidence is not None else None,
        "model": {"name": "vulturevision", "version": model_version},
        "processing_version": "cargoiq-lotvulture-adapter/1.0.0",
        "payload": {"lot_vulture_camera_id": camera_id, "lot_vulture_space_id": space_id, "scan_id": scan_id},
    }
    try:
        frame = camera_snapshot(camera_id, scan_id)
        payload["evidence"] = {
            "media_type": "image/jpeg",
            "file_name": f"{camera_id}-{space_id}-{scan_id}.jpg",
            "captured_at": payload["observed_at"],
            "base64": base64.b64encode(frame).decode("ascii"),
            "metadata": {"source": "Lot Vulture snapshot endpoint"},
        }
    except requests.RequestException as exc:
        print(f"snapshot unavailable for {camera_id}: {exc}")
    if not send_payload(payload):
        spool_payload(event_id, payload)
        print(f"spooled {event_id}")

def main() -> None:
    zone_map = load_json(ZONE_MAP_FILE, {})
    state = load_json(STATE_FILE, {"occupancy": {}})
    print("CargoIQ Lot Vulture edge adapter started")
    while True:
        replay_spool()
        try:
            for camera in camera_list():
                if camera.get("is_enabled") is False:
                    continue
                camera_id = int(camera["id"])
                body = live_camera(camera_id)
                scan_id = body.get("scan_id", body.get("scanId"))
                model_version = body.get("model_version") or body.get("modelVersion")
                for space in normalize_spaces(body):
                    value = space.get("occupied", space.get("is_occupied"))
                    if not isinstance(value, bool):
                        continue
                    key = f"{camera_id}:{space.get('id', space.get('space_id'))}"
                    previous = state["occupancy"].get(key)
                    state["occupancy"][key] = value
                    if previous is None or previous == value:
                        continue
                    emit_event(camera, space, value, scan_id, map_zone(zone_map, camera_id, space.get("id", space.get("space_id"))), model_version)
            save_state(state)
        except requests.RequestException as exc:
            print(f"Lot Vulture unavailable: {exc}")
        except Exception as exc:
            print(f"adapter error: {exc}")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
