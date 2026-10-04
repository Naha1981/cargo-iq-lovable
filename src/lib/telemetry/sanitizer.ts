import { telemetryContract, type TelemetryEventName } from "./events";

const MAX_STRING_LENGTH = 160;
const MAX_PAYLOAD_BYTES = 4096;

const PROHIBITED_KEY_PATTERN =
  /(^|_)(patient|person|member|name|email|phone|mobile|address|location|dob|birth|diagnos|symptom|treatment|medication|lab|vital|measurement|imaging|photo|scan|document|message|insurance|claim|referral|note|consent|accident|injury|genetic|biometric|health|clinical|prompt|response|query|header|body|url|pathname|referrer|stack|token|secret|password|cookie)(_|$)/i;

const PROHIBITED_VALUE_PATTERNS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?27|0)[6-8]\d{8}\b/,
  /\b\d{10,13}\b/,
  /https?:\/\//i,
];

type Primitive = string | number | boolean;

function isPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isDev(): boolean {
  return Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
}

function warn(message: string): void {
  if (isDev()) {
    console.warn("[NahaLabs telemetry blocked]", message);
  }
}

function valueMatchesProhibitedPattern(value: string): boolean {
  return PROHIBITED_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function valueMatchesExpectedType(value: Primitive, rule: "string" | "number" | "boolean"): boolean {
  if (rule === "string") return typeof value === "string";
  if (rule === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === "boolean";
}

export function sanitizeTelemetry(
  eventName: string,
  properties: Record<string, unknown>,
): { eventName: TelemetryEventName; properties: Record<string, Primitive> } | null {
  if (!Object.prototype.hasOwnProperty.call(telemetryContract, eventName)) {
    warn(`unknown event: ${eventName}`);
    return null;
  }

  const contract = telemetryContract[eventName as TelemetryEventName];
  if (!contract) {
    warn(`missing contract: ${eventName}`);
    return null;
  }

  const sanitized: Record<string, Primitive> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (PROHIBITED_KEY_PATTERN.test(key)) {
      warn(`prohibited property: ${key}`);
      continue;
    }

    const rule = contract.allowedProperties[key as keyof typeof contract.allowedProperties];
    if (!rule) {
      warn(`unknown property: ${key}`);
      continue;
    }

    if (!isPrimitive(value)) {
      warn(`non-primitive property: ${key}`);
      continue;
    }

    if (!valueMatchesExpectedType(value, rule)) {
      warn(`invalid property type: ${key}`);
      continue;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed || trimmed.length > MAX_STRING_LENGTH || valueMatchesProhibitedPattern(trimmed)) {
        warn(`unsafe string value: ${key}`);
        continue;
      }
      sanitized[key] = trimmed;
      continue;
    }

    if (typeof value === "number" && Math.abs(value) > 1_000_000_000) {
      warn(`out-of-range number: ${key}`);
      continue;
    }

    sanitized[key] = value;
  }

  const json = JSON.stringify(sanitized);
  if (new TextEncoder().encode(json).byteLength > MAX_PAYLOAD_BYTES) {
    warn(`payload too large: ${eventName}`);
    return null;
  }

  return {
    eventName: eventName as TelemetryEventName,
    properties: sanitized,
  };
}
