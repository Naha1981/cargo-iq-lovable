export const TELEMETRY_PRODUCT = "CargoIQ" as const;
export const TELEMETRY_CONTRACT_VERSION = 1 as const;

const property = (type: "string" | "number" | "boolean") => type;

export const telemetryEvents = {
  APP_OPENED: "app_opened",
  WORKFLOW_STARTED: "workflow_started",
  WORKFLOW_COMPLETED: "workflow_completed",
  WORKFLOW_FAILED: "workflow_failed",
  WORKFLOW_ABANDONED: "workflow_abandoned",
  WORKFLOW_RETRIED: "workflow_retried",
  INTEGRATION_CONNECTED: "integration_connected",
  INTEGRATION_DISCONNECTED: "integration_disconnected",
  INTEGRATION_SYNC_STARTED: "integration_sync_started",
  INTEGRATION_SYNC_COMPLETED: "integration_sync_completed",
  INTEGRATION_SYNC_FAILED: "integration_sync_failed",
  DEVICE_CONNECTED: "device_connected",
  DEVICE_DISCONNECTED: "device_disconnected",
  DEVICE_SYNC_STARTED: "device_sync_started",
  DEVICE_SYNC_COMPLETED: "device_sync_completed",
  DEVICE_SYNC_FAILED: "device_sync_failed",
  EVIDENCE_WORKFLOW_STARTED: "evidence_workflow_started",
  EVIDENCE_SOURCE_CONNECTED: "evidence_source_connected",
  EVIDENCE_BUNDLE_CREATED: "evidence_bundle_created",
  EVIDENCE_BUNDLE_VALIDATED: "evidence_bundle_validated",
  EVIDENCE_BUNDLE_EXPORTED: "evidence_bundle_exported",
  EVIDENCE_VALIDATION_FAILED: "evidence_validation_failed",
  AUTOMATION_STARTED: "automation_started",
  AUTOMATION_COMPLETED: "automation_completed",
  AUTOMATION_FAILED: "automation_failed",
  AUTOMATION_RETRIED: "automation_retried",
  REPORT_GENERATED: "report_generated",
  REPORT_EXPORTED: "report_exported",
  FEATURE_ENABLED: "feature_enabled",
  FEATURE_DISABLED: "feature_disabled",
  USER_INVITED: "user_invited",
  USER_ACTIVATED: "user_activated",
  SETTINGS_UPDATED: "settings_updated",
  API_REQUEST_FAILED: "api_request_failed",
} as const;

export type TelemetryEventName = (typeof telemetryEvents)[keyof typeof telemetryEvents];

export const telemetryContract = {
  app_opened: {
    purpose: "Measure application activation without identifying a person.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      product: property("string"),
      environment: property("string"),
      app_version: property("string"),
      platform: property("string"),
    },
  },
  workflow_started: {
    purpose: "Measure workflow starts and adoption.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      source: property("string"),
      platform: property("string"),
    },
  },
  workflow_completed: {
    purpose: "Measure successful workflow completion.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      duration_ms: property("number"),
      source: property("string"),
      status: property("string"),
    },
  },
  workflow_failed: {
    purpose: "Measure workflow reliability without raw exception content.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      error_code: property("string"),
      component: property("string"),
      retryable: property("boolean"),
    },
  },
  workflow_abandoned: {
    purpose: "Measure workflow drop-off.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      step: property("string"),
    },
  },
  workflow_retried: {
    purpose: "Measure retries needed to complete a workflow.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      retry_count: property("number"),
    },
  },
  integration_connected: {
    purpose: "Measure safe integration adoption.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      integration_type: property("string"),
    },
  },
  integration_disconnected: {
    purpose: "Measure integration lifecycle failures and churn.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      integration_type: property("string"),
      reason_code: property("string"),
    },
  },
  integration_sync_started: {
    purpose: "Measure integration sync execution.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      integration_type: property("string"),
    },
  },
  integration_sync_completed: {
    purpose: "Measure integration sync reliability and latency.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      integration_type: property("string"),
      duration_ms: property("number"),
    },
  },
  integration_sync_failed: {
    purpose: "Measure integration sync failures.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      integration_type: property("string"),
      error_code: property("string"),
      retryable: property("boolean"),
    },
  },
  device_connected: {
    purpose: "Measure device/infrastructure connection state.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      device_class: property("string"),
      connection_state: property("string"),
    },
  },
  device_disconnected: {
    purpose: "Measure device/infrastructure disconnections.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      device_class: property("string"),
      reason_code: property("string"),
    },
  },
  device_sync_started: {
    purpose: "Measure device sync execution.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      device_class: property("string"),
    },
  },
  device_sync_completed: {
    purpose: "Measure device sync reliability.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      device_class: property("string"),
      duration_ms: property("number"),
    },
  },
  device_sync_failed: {
    purpose: "Measure device sync failures without device payloads.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      device_class: property("string"),
      error_code: property("string"),
    },
  },
  evidence_workflow_started: {
    purpose: "Measure evidence workflow adoption without evidence content.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      workflow: property("string"),
      source_count: property("number"),
    },
  },
  evidence_source_connected: {
    purpose: "Measure evidence source connectivity without source payloads.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      source_type: property("string"),
    },
  },
  evidence_bundle_created: {
    purpose: "Measure evidence bundle creation without the evidence itself.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      source_count: property("number"),
      validation_status: property("string"),
    },
  },
  evidence_bundle_validated: {
    purpose: "Measure evidence validation success.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      validation_status: property("string"),
      duration_ms: property("number"),
    },
  },
  evidence_bundle_exported: {
    purpose: "Measure evidence export workflow completion.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      export_type: property("string"),
    },
  },
  evidence_validation_failed: {
    purpose: "Measure evidence validation failures without evidence content.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      error_code: property("string"),
      retryable: property("boolean"),
    },
  },
  automation_started: {
    purpose: "Measure automation starts.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      automation: property("string"),
    },
  },
  automation_completed: {
    purpose: "Measure automation success and duration.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      automation: property("string"),
      duration_ms: property("number"),
    },
  },
  automation_failed: {
    purpose: "Measure automation failures.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      automation: property("string"),
      error_code: property("string"),
    },
  },
  automation_retried: {
    purpose: "Measure automation retries.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      automation: property("string"),
      retry_count: property("number"),
    },
  },
  report_generated: {
    purpose: "Measure report generation.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      report_type: property("string"),
      duration_ms: property("number"),
    },
  },
  report_exported: {
    purpose: "Measure report export usage.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      report_type: property("string"),
      export_type: property("string"),
    },
  },
  feature_enabled: {
    purpose: "Measure product feature usage.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      feature: property("string"),
      variant: property("string"),
    },
  },
  feature_disabled: {
    purpose: "Measure feature disablement.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      feature: property("string"),
      reason_code: property("string"),
    },
  },
  user_invited: {
    purpose: "Measure safe user invitation actions.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      role: property("string"),
    },
  },
  user_activated: {
    purpose: "Measure application activation milestones without identity data.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      activation_step: property("string"),
    },
  },
  settings_updated: {
    purpose: "Measure safe product configuration changes.",
    privacy: "safe",
    owner: "NahaLabs Product",
    retention: "project-policy",
    allowedProperties: {
      setting: property("string"),
    },
  },
  api_request_failed: {
    purpose: "Measure API reliability using a coarse error code.",
    privacy: "safe",
    owner: "NahaLabs Platform",
    retention: "project-policy",
    allowedProperties: {
      component: property("string"),
      error_code: property("string"),
      retryable: property("boolean"),
      latency_ms: property("number"),
    },
  },
} as const;

export type TelemetryContract = typeof telemetryContract;
export type TelemetryEventContract = TelemetryContract[TelemetryEventName];

type RuleToType<T> =
  T extends "string" ? string :
  T extends "number" ? number :
  T extends "boolean" ? boolean :
  never;

export type TelemetryPayload<E extends TelemetryEventName> = Partial<{
  [K in keyof TelemetryContract[E]["allowedProperties"]]:
    RuleToType<TelemetryContract[E]["allowedProperties"][K]>;
}>;
