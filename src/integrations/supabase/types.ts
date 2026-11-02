export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_errors: {
        Row: {
          created_at: string
          id: string
          message: string | null
          route: string | null
          source: string | null
          stack: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          route?: string | null
          source?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          route?: string | null
          source?: string | null
          stack?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      appointment_attributions: {
        Row: {
          appointment_clock_id: string
          assertion: string
          case_id: string
          claim_target: string
          claimant: string
          created_at: string
          created_by: string
          id: string
          source_document_id: string
          source_reference: string
          tenant_id: string
          terms_reference: string
        }
        Insert: {
          appointment_clock_id: string
          assertion: string
          case_id: string
          claim_target: string
          claimant: string
          created_at?: string
          created_by: string
          id?: string
          source_document_id: string
          source_reference: string
          tenant_id: string
          terms_reference: string
        }
        Update: {
          appointment_clock_id?: string
          assertion?: string
          case_id?: string
          claim_target?: string
          claimant?: string
          created_at?: string
          created_by?: string
          id?: string
          source_document_id?: string
          source_reference?: string
          tenant_id?: string
          terms_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_attributions_appointment_clock_id_fkey"
            columns: ["appointment_clock_id"]
            isOneToOne: false
            referencedRelation: "operational_clocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_attributions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_attributions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_attributions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_lifecycle: {
        Row: {
          appointment_reference: string
          case_id: string
          claim_target: string
          created_at: string
          created_by: string
          end_at: string | null
          explanation: string
          id: string
          import_id: string | null
          issuer: string
          occurred_at: string
          outcome: string
          party: string
          physical_reference: string
          record_type: string
          source_document_id: string
          source_reference: string
          start_at: string | null
          supersedes_id: string | null
          tenant_id: string
          terms_reference: string
          version: number
        }
        Insert: {
          appointment_reference: string
          case_id: string
          claim_target: string
          created_at?: string
          created_by: string
          end_at?: string | null
          explanation: string
          id?: string
          import_id?: string | null
          issuer: string
          occurred_at: string
          outcome: string
          party: string
          physical_reference: string
          record_type: string
          source_document_id: string
          source_reference: string
          start_at?: string | null
          supersedes_id?: string | null
          tenant_id: string
          terms_reference: string
          version: number
        }
        Update: {
          appointment_reference?: string
          case_id?: string
          claim_target?: string
          created_at?: string
          created_by?: string
          end_at?: string | null
          explanation?: string
          id?: string
          import_id?: string | null
          issuer?: string
          occurred_at?: string
          outcome?: string
          party?: string
          physical_reference?: string
          record_type?: string
          source_document_id?: string
          source_reference?: string
          start_at?: string | null
          supersedes_id?: string | null
          tenant_id?: string
          terms_reference?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "appointment_lifecycle_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_lifecycle_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "authorised_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_lifecycle_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_lifecycle_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "appointment_lifecycle"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_lifecycle_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          case_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          payload: Json | null
          tenant_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          case_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json | null
          tenant_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          case_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      authorised_imports: {
        Row: {
          authorization_basis: string
          case_id: string
          created_at: string
          created_by: string
          dataset: string
          exported_at: string
          id: string
          raw_csv: string
          raw_sha256: string
          row_count: number
          source_document_id: string
          source_party: string
          tenant_id: string
        }
        Insert: {
          authorization_basis: string
          case_id: string
          created_at?: string
          created_by: string
          dataset: string
          exported_at: string
          id?: string
          raw_csv: string
          raw_sha256: string
          row_count: number
          source_document_id: string
          source_party: string
          tenant_id: string
        }
        Update: {
          authorization_basis?: string
          case_id?: string
          created_at?: string
          created_by?: string
          dataset?: string
          exported_at?: string
          id?: string
          raw_csv?: string
          raw_sha256?: string
          row_count?: number
          source_document_id?: string
          source_party?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorised_imports_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorised_imports_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorised_imports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          container_no: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          dd_evidence_draft: Json | null
          dd_evidence_draft_revision: number
          dispute_type: string
          id: string
          port_code: string | null
          reference_no: string
          status: string
          tenant_id: string
          title: string | null
          vessel_name: string | null
          voyage_no: string | null
        }
        Insert: {
          container_no?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          dd_evidence_draft?: Json | null
          dd_evidence_draft_revision?: number
          dispute_type?: string
          id?: string
          port_code?: string | null
          reference_no: string
          status?: string
          tenant_id: string
          title?: string | null
          vessel_name?: string | null
          voyage_no?: string | null
        }
        Update: {
          container_no?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          dd_evidence_draft?: Json | null
          dd_evidence_draft_revision?: number
          dispute_type?: string
          id?: string
          port_code?: string | null
          reference_no?: string
          status?: string
          tenant_id?: string
          title?: string | null
          vessel_name?: string | null
          voyage_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cctv_cameras: {
        Row: {
          created_at: string
          display_name: string
          health_status: string
          id: string
          installation_location: string | null
          last_seen_at: string | null
          latitude: number | null
          longitude: number | null
          manufacturer: string | null
          provider_camera_id: string
          source_id: string
          stream_type: string | null
          tenant_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          health_status?: string
          id?: string
          installation_location?: string | null
          last_seen_at?: string | null
          latitude?: number | null
          longitude?: number | null
          manufacturer?: string | null
          provider_camera_id: string
          source_id: string
          stream_type?: string | null
          tenant_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          health_status?: string
          id?: string
          installation_location?: string | null
          last_seen_at?: string | null
          latitude?: number | null
          longitude?: number | null
          manufacturer?: string | null
          provider_camera_id?: string
          source_id?: string
          stream_type?: string | null
          tenant_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cctv_cameras_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cctv_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cctv_evidence_artifacts: {
        Row: {
          byte_size: number
          camera_id: string | null
          captured_at: string | null
          created_at: string
          file_name: string | null
          id: string
          immutable: boolean
          media_type: string
          metadata: Json
          model_name: string | null
          model_version: string | null
          observation_id: string
          processing_version: string | null
          retrieved_at: string
          sha256_hash: string
          source_id: string
          source_timestamp: string | null
          storage_path: string
          tenant_id: string
        }
        Insert: {
          byte_size: number
          camera_id?: string | null
          captured_at?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          immutable?: boolean
          media_type: string
          metadata?: Json
          model_name?: string | null
          model_version?: string | null
          observation_id: string
          processing_version?: string | null
          retrieved_at?: string
          sha256_hash: string
          source_id: string
          source_timestamp?: string | null
          storage_path: string
          tenant_id: string
        }
        Update: {
          byte_size?: number
          camera_id?: string | null
          captured_at?: string | null
          created_at?: string
          file_name?: string | null
          id?: string
          immutable?: boolean
          media_type?: string
          metadata?: Json
          model_name?: string | null
          model_version?: string | null
          observation_id?: string
          processing_version?: string | null
          retrieved_at?: string
          sha256_hash?: string
          source_id?: string
          source_timestamp?: string | null
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cctv_evidence_artifacts_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cctv_cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cctv_evidence_artifacts_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "cctv_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cctv_evidence_artifacts_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cctv_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cctv_ingest_nonces: {
        Row: {
          id: string
          nonce: string
          observed_at: string
          source_id: string
        }
        Insert: {
          id?: string
          nonce: string
          observed_at?: string
          source_id: string
        }
        Update: {
          id?: string
          nonce?: string
          observed_at?: string
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cctv_ingest_nonces_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cctv_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      cctv_observations: {
        Row: {
          camera_id: string | null
          case_id: string | null
          confidence: number | null
          created_at: string
          detected_class: string | null
          event_type: string
          evidence_available: boolean
          external_observation_id: string | null
          id: string
          idempotency_key: string
          model_name: string | null
          model_version: string | null
          observed_at: string
          payload: Json
          processed_at: string | null
          processing_version: string | null
          provider_event_id: string | null
          received_at: string
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          roi: Json | null
          source_id: string
          source_observed_at: string | null
          tenant_id: string
          timeline_event_id: string | null
          timezone: string | null
          zone_id: string | null
        }
        Insert: {
          camera_id?: string | null
          case_id?: string | null
          confidence?: number | null
          created_at?: string
          detected_class?: string | null
          event_type: string
          evidence_available?: boolean
          external_observation_id?: string | null
          id?: string
          idempotency_key: string
          model_name?: string | null
          model_version?: string | null
          observed_at: string
          payload?: Json
          processed_at?: string | null
          processing_version?: string | null
          provider_event_id?: string | null
          received_at?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          roi?: Json | null
          source_id: string
          source_observed_at?: string | null
          tenant_id: string
          timeline_event_id?: string | null
          timezone?: string | null
          zone_id?: string | null
        }
        Update: {
          camera_id?: string | null
          case_id?: string | null
          confidence?: number | null
          created_at?: string
          detected_class?: string | null
          event_type?: string
          evidence_available?: boolean
          external_observation_id?: string | null
          id?: string
          idempotency_key?: string
          model_name?: string | null
          model_version?: string | null
          observed_at?: string
          payload?: Json
          processed_at?: string | null
          processing_version?: string | null
          provider_event_id?: string | null
          received_at?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          roi?: Json | null
          source_id?: string
          source_observed_at?: string | null
          tenant_id?: string
          timeline_event_id?: string | null
          timezone?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cctv_observations_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cctv_cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cctv_observations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cctv_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "cctv_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cctv_observations_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "cctv_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      cctv_sources: {
        Row: {
          created_at: string
          created_by: string | null
          deployment_type: string
          enabled: boolean
          id: string
          ingest_secret_ciphertext: string
          license_status: string
          name: string
          privacy_notes: string | null
          provider: string
          provider_version: string | null
          retention_days: number
          site_location: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deployment_type?: string
          enabled?: boolean
          id?: string
          ingest_secret_ciphertext: string
          license_status?: string
          name: string
          privacy_notes?: string | null
          provider?: string
          provider_version?: string | null
          retention_days?: number
          site_location?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deployment_type?: string
          enabled?: boolean
          id?: string
          ingest_secret_ciphertext?: string
          license_status?: string
          name?: string
          privacy_notes?: string | null
          provider?: string
          provider_version?: string | null
          retention_days?: number
          site_location?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      cctv_zones: {
        Row: {
          camera_id: string
          created_at: string
          id: string
          polygon: Json | null
          provider_zone_id: string | null
          semantic_purpose: string | null
          tenant_id: string
          zone_code: string
          zone_type: string
        }
        Insert: {
          camera_id: string
          created_at?: string
          id?: string
          polygon?: Json | null
          provider_zone_id?: string | null
          semantic_purpose?: string | null
          tenant_id: string
          zone_code: string
          zone_type?: string
        }
        Update: {
          camera_id?: string
          created_at?: string
          id?: string
          polygon?: Json | null
          provider_zone_id?: string | null
          semantic_purpose?: string | null
          tenant_id?: string
          zone_code?: string
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cctv_zones_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cctv_cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      clock_reconciliations: {
        Row: {
          case_id: string
          considered_clock_ids: string[]
          created_at: string
          created_by: string
          explanation: string
          id: string
          kind: string
          physical_reference: string
          selected_clock_id: string
          source_document_id: string
          source_reference: string
          tenant_id: string
          version: number
        }
        Insert: {
          case_id: string
          considered_clock_ids: string[]
          created_at?: string
          created_by: string
          explanation: string
          id?: string
          kind: string
          physical_reference: string
          selected_clock_id: string
          source_document_id: string
          source_reference: string
          tenant_id: string
          version: number
        }
        Update: {
          case_id?: string
          considered_clock_ids?: string[]
          created_at?: string
          created_by?: string
          explanation?: string
          id?: string
          kind?: string
          physical_reference?: string
          selected_clock_id?: string
          source_document_id?: string
          source_reference?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "clock_reconciliations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_reconciliations_selected_clock_id_fkey"
            columns: ["selected_clock_id"]
            isOneToOne: false
            referencedRelation: "operational_clocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_reconciliations_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_reconciliations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commercial_rules: {
        Row: {
          active: boolean
          created_at: string
          currency: string | null
          id: string
          name: string
          payload: Json | null
          rule_type: string
          rule_version: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string | null
          id?: string
          name: string
          payload?: Json | null
          rule_type: string
          rule_version: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string | null
          id?: string
          name?: string
          payload?: Json | null
          rule_type?: string
          rule_version?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "commercial_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contradictions: {
        Row: {
          case_id: string
          citations: Json | null
          claim_a_id: string | null
          claim_b_id: string | null
          created_at: string
          description: string | null
          detected_by: string
          id: string
          resolution_document_id: string | null
          resolution_evidence_reference: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          tenant_id: string
          title: string
        }
        Insert: {
          case_id: string
          citations?: Json | null
          claim_a_id?: string | null
          claim_b_id?: string | null
          created_at?: string
          description?: string | null
          detected_by?: string
          id?: string
          resolution_document_id?: string | null
          resolution_evidence_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id: string
          title: string
        }
        Update: {
          case_id?: string
          citations?: Json | null
          claim_a_id?: string | null
          claim_b_id?: string | null
          created_at?: string
          description?: string | null
          detected_by?: string
          id?: string
          resolution_document_id?: string | null
          resolution_evidence_reference?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "contradictions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_claim_a_id_fkey"
            columns: ["claim_a_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_claim_b_id_fkey"
            columns: ["claim_b_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_resolution_document_id_fkey"
            columns: ["resolution_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contradictions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_recovery_links: {
        Row: {
          alert_id: string | null
          amount: number | null
          case_id: string
          cost_category: string
          created_at: string
          created_by: string | null
          currency: string
          event_id: string | null
          evidence_ref: string | null
          id: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          alert_id?: string | null
          amount?: number | null
          case_id: string
          cost_category: string
          created_at?: string
          created_by?: string | null
          currency?: string
          event_id?: string | null
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          alert_id?: string | null
          amount?: number | null
          case_id?: string
          cost_category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          event_id?: string | null
          evidence_ref?: string | null
          id?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_recovery_links_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "risk_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_recovery_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_recovery_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "risk_events"
            referencedColumns: ["id"]
          },
        ]
      }
      count_comparison_definitions: {
        Row: {
          acceptance: string
          case_id: string
          created_at: string
          created_by: string
          id: string
          kpi_definition_id: string | null
          metric: string
          name: string
          output_unit: string
          physical_references: string[]
          rationale: string
          rule_ids: string[]
          source_document_id: string
          source_reference: string
          supersedes_id: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          acceptance: string
          case_id: string
          created_at?: string
          created_by: string
          id?: string
          kpi_definition_id?: string | null
          metric: string
          name: string
          output_unit: string
          physical_references: string[]
          rationale: string
          rule_ids: string[]
          source_document_id: string
          source_reference: string
          supersedes_id?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          acceptance?: string
          case_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kpi_definition_id?: string | null
          metric?: string
          name?: string
          output_unit?: string
          physical_references?: string[]
          rationale?: string
          rule_ids?: string[]
          source_document_id?: string
          source_reference?: string
          supersedes_id?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "count_comparison_definitions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_comparison_definitions_kpi_definition_id_fkey"
            columns: ["kpi_definition_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_comparison_definitions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_comparison_definitions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "count_comparison_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_comparison_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      count_rule_versions: {
        Row: {
          acceptance: string
          calculation: string
          case_id: string
          created_at: string
          created_by: string
          denominator: number
          effective_from: string
          effective_to: string | null
          gate_kinds: string[]
          id: string
          input_basis: string
          metric: string
          name: string
          numerator: number
          output_unit: string
          rationale: string
          source_document_id: string
          source_reference: string
          supersedes_id: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          acceptance: string
          calculation: string
          case_id: string
          created_at?: string
          created_by: string
          denominator: number
          effective_from: string
          effective_to?: string | null
          gate_kinds?: string[]
          id?: string
          input_basis: string
          metric: string
          name: string
          numerator: number
          output_unit: string
          rationale: string
          source_document_id: string
          source_reference: string
          supersedes_id?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          acceptance?: string
          calculation?: string
          case_id?: string
          created_at?: string
          created_by?: string
          denominator?: number
          effective_from?: string
          effective_to?: string | null
          gate_kinds?: string[]
          id?: string
          input_basis?: string
          metric?: string
          name?: string
          numerator?: number
          output_unit?: string
          rationale?: string
          source_document_id?: string
          source_reference?: string
          supersedes_id?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "count_rule_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_rule_versions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_rule_versions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "count_rule_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_rule_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      count_source_records: {
        Row: {
          basis: string
          case_id: string
          containers20: number | null
          containers40: number | null
          created_at: string
          created_by: string
          gate_kind: string
          id: string
          import_id: string | null
          limitations: string
          metric: string
          occurred_at: string
          party: string
          physical_reference: string
          quantity: number
          source_document_id: string
          source_reference: string
          supersedes_id: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          basis: string
          case_id: string
          containers20?: number | null
          containers40?: number | null
          created_at?: string
          created_by: string
          gate_kind: string
          id?: string
          import_id?: string | null
          limitations: string
          metric: string
          occurred_at: string
          party: string
          physical_reference: string
          quantity: number
          source_document_id: string
          source_reference: string
          supersedes_id?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          basis?: string
          case_id?: string
          containers20?: number | null
          containers40?: number | null
          created_at?: string
          created_by?: string
          gate_kind?: string
          id?: string
          import_id?: string | null
          limitations?: string
          metric?: string
          occurred_at?: string
          party?: string
          physical_reference?: string
          quantity?: number
          source_document_id?: string
          source_reference?: string
          supersedes_id?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "count_source_records_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_source_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "authorised_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_source_records_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_source_records_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "count_source_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "count_source_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_party_match_reviews: {
        Row: {
          case_id: string
          created_at: string
          created_by: string
          explanation: string
          id: string
          match_id: string
          source_document_id: string
          source_reference: string
          status: string
          tenant_id: string
          version: number
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by: string
          explanation: string
          id?: string
          match_id: string
          source_document_id: string
          source_reference: string
          status: string
          tenant_id: string
          version: number
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string
          explanation?: string
          id?: string
          match_id?: string
          source_document_id?: string
          source_reference?: string
          status?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "cross_party_match_reviews_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_match_reviews_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "cross_party_matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_match_reviews_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_match_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cross_party_matches: {
        Row: {
          case_id: string
          claim_a_id: string
          claim_b_id: string
          contradiction_id: string | null
          created_at: string
          created_by: string
          event_reference: string
          id: string
          rationale: string
          result: string
          tenant_id: string
        }
        Insert: {
          case_id: string
          claim_a_id: string
          claim_b_id: string
          contradiction_id?: string | null
          created_at?: string
          created_by: string
          event_reference: string
          id?: string
          rationale: string
          result: string
          tenant_id: string
        }
        Update: {
          case_id?: string
          claim_a_id?: string
          claim_b_id?: string
          contradiction_id?: string | null
          created_at?: string
          created_by?: string
          event_reference?: string
          id?: string
          rationale?: string
          result?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cross_party_matches_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_matches_claim_a_id_fkey"
            columns: ["claim_a_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_matches_claim_b_id_fkey"
            columns: ["claim_b_id"]
            isOneToOne: false
            referencedRelation: "extracted_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_matches_contradiction_id_fkey"
            columns: ["contradiction_id"]
            isOneToOne: false
            referencedRelation: "contradictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cross_party_matches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      document_content_ownership: {
        Row: {
          case_id: string
          claimed_at: string
          document_id: string
          sha256_hash: string
          tenant_id: string
        }
        Insert: {
          case_id: string
          claimed_at?: string
          document_id: string
          sha256_hash: string
          tenant_id: string
        }
        Update: {
          case_id?: string
          claimed_at?: string
          document_id?: string
          sha256_hash?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_content_ownership_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          case_id: string
          evidence_class: string
          extraction_status: string
          file_path: string
          file_type: string
          id: string
          name: string
          sha256_hash: string
          source_party: string | null
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          case_id: string
          evidence_class?: string
          extraction_status?: string
          file_path: string
          file_type: string
          id?: string
          name: string
          sha256_hash: string
          source_party?: string | null
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          case_id?: string
          evidence_class?: string
          extraction_status?: string
          file_path?: string
          file_type?: string
          id?: string
          name?: string
          sha256_hash?: string
          source_party?: string | null
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_gap_entries: {
        Row: {
          case_id: string
          created_at: string
          created_by: string
          document_ids: string[]
          evidence_reference: string
          explanation: string
          id: string
          physical_reference: string
          required_event: string
          requirement_basis: string
          status: string
          supersedes_id: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by: string
          document_ids?: string[]
          evidence_reference: string
          explanation: string
          id?: string
          physical_reference: string
          required_event: string
          requirement_basis: string
          status: string
          supersedes_id?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by?: string
          document_ids?: string[]
          evidence_reference?: string
          explanation?: string
          id?: string
          physical_reference?: string
          required_event?: string
          requirement_basis?: string
          status?: string
          supersedes_id?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_gap_entries_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_gap_entries_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "evidence_gap_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_gap_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evidence_packs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          canonical_payload: string | null
          case_id: string
          generated_at: string
          id: string
          pack_payload: Json
          sha256_hash: string
          status: string
          tenant_id: string
          version: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          canonical_payload?: string | null
          case_id: string
          generated_at?: string
          id?: string
          pack_payload: Json
          sha256_hash: string
          status?: string
          tenant_id: string
          version: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          canonical_payload?: string | null
          case_id?: string
          generated_at?: string
          id?: string
          pack_payload?: Json
          sha256_hash?: string
          status?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_packs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_packs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      external_observations: {
        Row: {
          case_id: string
          confidence: number | null
          created_at: string
          id: string
          latitude: number | null
          limitation: string | null
          longitude: number | null
          observation_type: string
          observed_at: string
          payload: Json | null
          source: string
          tenant_id: string
        }
        Insert: {
          case_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          latitude?: number | null
          limitation?: string | null
          longitude?: number | null
          observation_type: string
          observed_at: string
          payload?: Json | null
          source: string
          tenant_id: string
        }
        Update: {
          case_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          latitude?: number | null
          limitation?: string | null
          longitude?: number | null
          observation_type?: string
          observed_at?: string
          payload?: Json | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_observations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_observations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_claims: {
        Row: {
          case_id: string
          claim_text: string
          claim_type: string | null
          confidence: number | null
          created_at: string
          document_id: string | null
          evidence_class: string
          id: string
          nature: string
          normalized_value: Json | null
          page_number: number | null
          source_seq: number | null
          status: string
          tenant_id: string
          timestamp_claimed: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          claim_text: string
          claim_type?: string | null
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          evidence_class?: string
          id?: string
          nature?: string
          normalized_value?: Json | null
          page_number?: number | null
          source_seq?: number | null
          status?: string
          tenant_id: string
          timestamp_claimed?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          claim_text?: string
          claim_type?: string | null
          confidence?: number | null
          created_at?: string
          document_id?: string | null
          evidence_class?: string
          id?: string
          nature?: string
          normalized_value?: Json | null
          page_number?: number | null
          source_seq?: number | null
          status?: string
          tenant_id?: string
          timestamp_claimed?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "extracted_claims_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_claims_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extracted_claims_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      extraction_usage: {
        Row: {
          case_id: string | null
          cost_usd_estimate: number | null
          created_at: string
          document_id: string | null
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          provider: string
          request_id: string | null
          reserved_at: string | null
          reserved_cost_usd: number | null
          status: string
          tenant_id: string
        }
        Insert: {
          case_id?: string | null
          cost_usd_estimate?: number | null
          created_at?: string
          document_id?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          provider: string
          request_id?: string | null
          reserved_at?: string | null
          reserved_cost_usd?: number | null
          status?: string
          tenant_id: string
        }
        Update: {
          case_id?: string | null
          cost_usd_estimate?: number | null
          created_at?: string
          document_id?: string | null
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          provider?: string
          request_id?: string | null
          reserved_at?: string | null
          reserved_cost_usd?: number | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extraction_usage_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_usage_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extraction_usage_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_calculations: {
        Row: {
          calculated_amount_minor: number | null
          calculation_type: string
          case_id: string
          charged_amount_minor: number | null
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          input_payload: Json | null
          result_payload: Json | null
          rule_version: string | null
          tenant_id: string
          variance_minor: number | null
        }
        Insert: {
          calculated_amount_minor?: number | null
          calculation_type: string
          case_id: string
          charged_amount_minor?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          input_payload?: Json | null
          result_payload?: Json | null
          rule_version?: string | null
          tenant_id: string
          variance_minor?: number | null
        }
        Update: {
          calculated_amount_minor?: number | null
          calculation_type?: string
          case_id?: string
          charged_amount_minor?: number | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          input_payload?: Json | null
          result_payload?: Json | null
          rule_version?: string | null
          tenant_id?: string
          variance_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_calculations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_calculations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      free_extraction_attempts: {
        Row: {
          attempts: number
          day: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          day: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          day?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_extraction_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      geospatial_finding_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json
          finding_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json
          finding_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json
          finding_id?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "geospatial_finding_events_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "geospatial_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geospatial_finding_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      geospatial_findings: {
        Row: {
          alternatives: string | null
          case_id: string | null
          confidence: string
          created_at: string
          created_by: string | null
          event_time: string | null
          id: string
          latitude: number | null
          limitations: string | null
          longitude: number | null
          method: string
          next_action: string | null
          observation_time: string | null
          rationale: string | null
          review_status: string
          source: string
          summary: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          alternatives?: string | null
          case_id?: string | null
          confidence?: string
          created_at?: string
          created_by?: string | null
          event_time?: string | null
          id?: string
          latitude?: number | null
          limitations?: string | null
          longitude?: number | null
          method: string
          next_action?: string | null
          observation_time?: string | null
          rationale?: string | null
          review_status?: string
          source: string
          summary?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          alternatives?: string | null
          case_id?: string | null
          confidence?: string
          created_at?: string
          created_by?: string | null
          event_time?: string | null
          id?: string
          latitude?: number | null
          limitations?: string | null
          longitude?: number | null
          method?: string
          next_action?: string | null
          observation_time?: string | null
          rationale?: string | null
          review_status?: string
          source?: string
          summary?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "geospatial_findings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "geospatial_findings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      health_email_sends: {
        Row: {
          created_at: string
          day: string
          detail: string | null
          lease_expires_at: string
          provider_message_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day: string
          detail?: string | null
          lease_expires_at: string
          provider_message_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day?: string
          detail?: string | null
          lease_expires_at?: string
          provider_message_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      kpi_definitions: {
        Row: {
          acceptance: string
          benchmark_basis: string
          benchmark_hours: number | null
          case_id: string
          created_at: string
          created_by: string
          definition: string
          end_kind: string
          id: string
          name: string
          party: string
          physical_reference: string
          source_document_id: string
          source_reference: string
          start_kind: string
          supersedes_id: string | null
          tenant_id: string
          version: number
        }
        Insert: {
          acceptance: string
          benchmark_basis: string
          benchmark_hours?: number | null
          case_id: string
          created_at?: string
          created_by: string
          definition: string
          end_kind: string
          id?: string
          name: string
          party: string
          physical_reference: string
          source_document_id: string
          source_reference: string
          start_kind: string
          supersedes_id?: string | null
          tenant_id: string
          version: number
        }
        Update: {
          acceptance?: string
          benchmark_basis?: string
          benchmark_hours?: number | null
          case_id?: string
          created_at?: string
          created_by?: string
          definition?: string
          end_kind?: string
          id?: string
          name?: string
          party?: string
          physical_reference?: string
          source_document_id?: string
          source_reference?: string
          start_kind?: string
          supersedes_id?: string | null
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_definitions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "kpi_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_clocks: {
        Row: {
          appointment_issuer: string | null
          appointment_parties: string | null
          appointment_reference: string | null
          appointment_terms: string | null
          case_id: string
          created_at: string
          created_by: string
          id: string
          kind: string
          location_basis: string
          occurred_at: string
          physical_reference: string
          source_document_id: string
          source_party: string
          source_reference: string
          tenant_id: string
          time_zone: string
          timestamp_original: string
        }
        Insert: {
          appointment_issuer?: string | null
          appointment_parties?: string | null
          appointment_reference?: string | null
          appointment_terms?: string | null
          case_id: string
          created_at?: string
          created_by: string
          id?: string
          kind: string
          location_basis: string
          occurred_at: string
          physical_reference: string
          source_document_id: string
          source_party: string
          source_reference: string
          tenant_id: string
          time_zone: string
          timestamp_original: string
        }
        Update: {
          appointment_issuer?: string | null
          appointment_parties?: string | null
          appointment_reference?: string | null
          appointment_terms?: string | null
          case_id?: string
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          location_basis?: string
          occurred_at?: string
          physical_reference?: string
          source_document_id?: string
          source_party?: string
          source_reference?: string
          tenant_id?: string
          time_zone?: string
          timestamp_original?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_clocks_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_clocks_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_clocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_definitions: {
        Row: {
          acceptance: string
          acceptance_basis: string
          case_id: string
          created_at: string
          created_by: string
          effective_from: string
          effective_to: string | null
          id: string
          metric: string
          original_source_text: string
          party: string
          rule: string
          source_document_id: string
          source_reference: string
          supersedes_id: string | null
          tenant_id: string
          unit: string
          version: number
        }
        Insert: {
          acceptance: string
          acceptance_basis: string
          case_id: string
          created_at?: string
          created_by: string
          effective_from: string
          effective_to?: string | null
          id?: string
          metric: string
          original_source_text: string
          party: string
          rule: string
          source_document_id: string
          source_reference: string
          supersedes_id?: string | null
          tenant_id: string
          unit: string
          version: number
        }
        Update: {
          acceptance?: string
          acceptance_basis?: string
          case_id?: string
          created_at?: string
          created_by?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          metric?: string
          original_source_text?: string
          party?: string
          rule?: string
          source_document_id?: string
          source_reference?: string
          supersedes_id?: string | null
          tenant_id?: string
          unit?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "operational_definitions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_definitions_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_definitions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "operational_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          email: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recovery_finding_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json
          finding_id: string
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json
          finding_id: string
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json
          finding_id?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_finding_events_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "recovery_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_finding_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      recovery_findings: {
        Row: {
          actual_amount: number | null
          assigned_to: string | null
          calculation: Json
          case_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          evidence_refs: Json
          expected_amount: number | null
          finding_type: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_document_ids: string[]
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          actual_amount?: number | null
          assigned_to?: string | null
          calculation?: Json
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          evidence_refs?: Json
          expected_amount?: number | null
          finding_type: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_document_ids?: string[]
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          actual_amount?: number | null
          assigned_to?: string | null
          calculation?: Json
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          evidence_refs?: Json
          expected_amount?: number | null
          finding_type?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_document_ids?: string[]
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recovery_findings_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recovery_findings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_alert_verifications: {
        Row: {
          alert_id: string
          decided_at: string
          decided_by: string
          decision: string
          id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          alert_id: string
          decided_at?: string
          decided_by: string
          decision: string
          id?: string
          notes?: string | null
          tenant_id: string
        }
        Update: {
          alert_id?: string
          decided_at?: string
          decided_by?: string
          decision?: string
          id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_alert_verifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "risk_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_alerts: {
        Row: {
          case_id: string | null
          confidence: string
          created_at: string
          event_id: string
          evidence_summary: string
          headline: string
          id: string
          likely_impact: string | null
          recommended_action: string | null
          risk_explanation: string
          severity: string
          status: string
          tenant_id: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          case_id?: string | null
          confidence?: string
          created_at?: string
          event_id: string
          evidence_summary: string
          headline: string
          id?: string
          likely_impact?: string | null
          recommended_action?: string | null
          risk_explanation: string
          severity?: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          case_id?: string | null
          confidence?: string
          created_at?: string
          event_id?: string
          evidence_summary?: string
          headline?: string
          id?: string
          likely_impact?: string | null
          recommended_action?: string | null
          risk_explanation?: string
          severity?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_alerts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "risk_events"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_event_case_links: {
        Row: {
          case_id: string
          confidence: string
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          match_basis: string
          rationale: string
          tenant_id: string
        }
        Insert: {
          case_id: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          event_id: string
          id?: string
          match_basis: string
          rationale: string
          tenant_id: string
        }
        Update: {
          case_id?: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          event_id?: string
          id?: string
          match_basis?: string
          rationale?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_event_case_links_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_event_case_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "risk_events"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_events: {
        Row: {
          confidence: string
          corridor: string | null
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          ingested_at: string
          kind: string
          latitude: number | null
          longitude: number | null
          observed_at: string
          port_code: string | null
          raw: Json | null
          source: string
          source_ref: string | null
          summary: string | null
          tenant_id: string
          title: string
          verification_status: string
          vessel_name: string | null
        }
        Insert: {
          confidence?: string
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          id?: string
          ingested_at?: string
          kind: string
          latitude?: number | null
          longitude?: number | null
          observed_at: string
          port_code?: string | null
          raw?: Json | null
          source: string
          source_ref?: string | null
          summary?: string | null
          tenant_id: string
          title: string
          verification_status?: string
          vessel_name?: string | null
        }
        Update: {
          confidence?: string
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          id?: string
          ingested_at?: string
          kind?: string
          latitude?: number | null
          longitude?: number | null
          observed_at?: string
          port_code?: string | null
          raw?: Json | null
          source?: string
          source_ref?: string | null
          summary?: string | null
          tenant_id?: string
          title?: string
          verification_status?: string
          vessel_name?: string | null
        }
        Relationships: []
      }
      risk_source_configs: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          max_events_per_day: number
          settings: Json
          source: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_events_per_day?: number
          settings?: Json
          source: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          max_events_per_day?: number
          settings?: Json
          source?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      scene_asset_events: {
        Row: {
          action: string
          actor: string | null
          asset_id: string
          created_at: string
          detail: Json
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          asset_id: string
          created_at?: string
          detail?: Json
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          asset_id?: string
          created_at?: string
          detail?: Json
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_asset_events_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "scene_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_asset_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      scene_assets: {
        Row: {
          acquired_at: string | null
          case_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          provenance: Json
          source_ref: string | null
          source_type: string
          status: string
          tenant_id: string
          tileset_url: string | null
          updated_at: string
        }
        Insert: {
          acquired_at?: string | null
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          provenance?: Json
          source_ref?: string | null
          source_type: string
          status?: string
          tenant_id: string
          tileset_url?: string | null
          updated_at?: string
        }
        Update: {
          acquired_at?: string | null
          case_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          provenance?: Json
          source_ref?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
          tileset_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scene_assets_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scene_assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_scenario_events: {
        Row: {
          action: string
          actor: string | null
          created_at: string
          detail: Json
          id: string
          scenario_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          created_at?: string
          detail?: Json
          id?: string
          scenario_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          created_at?: string
          detail?: Json
          id?: string
          scenario_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "simulation_scenario_events_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "simulation_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_scenarios: {
        Row: {
          area_description: string | null
          assumptions: Json
          baseline_metrics: Json | null
          comparison_summary: Json | null
          corridor: string | null
          created_at: string
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          decision_action: string | null
          decision_summary: string | null
          ends_at: string | null
          evidence_refs: Json
          id: string
          name: string
          port_code: string | null
          scenario_metrics: Json | null
          scenario_type: string
          severity: string
          starts_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          vessel_name: string | null
        }
        Insert: {
          area_description?: string | null
          assumptions?: Json
          baseline_metrics?: Json | null
          comparison_summary?: Json | null
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_action?: string | null
          decision_summary?: string | null
          ends_at?: string | null
          evidence_refs?: Json
          id?: string
          name: string
          port_code?: string | null
          scenario_metrics?: Json | null
          scenario_type: string
          severity?: string
          starts_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          vessel_name?: string | null
        }
        Update: {
          area_description?: string | null
          assumptions?: Json
          baseline_metrics?: Json | null
          comparison_summary?: Json | null
          corridor?: string | null
          created_at?: string
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_action?: string | null
          decision_summary?: string | null
          ends_at?: string | null
          evidence_refs?: Json
          id?: string
          name?: string
          port_code?: string | null
          scenario_metrics?: Json | null
          scenario_type?: string
          severity?: string
          starts_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          vessel_name?: string | null
        }
        Relationships: []
      }
      tenant_free_caps: {
        Row: {
          daily_attempts: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          daily_attempts?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          daily_attempts?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_free_caps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: string
          tenant_id: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string
          role: string
          tenant_id: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: string
          tenant_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_upload_concurrency: {
        Row: {
          max_concurrent: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          max_concurrent?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          max_concurrent?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_upload_concurrency_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      timeline_events: {
        Row: {
          case_id: string
          coordinates: Json | null
          created_at: string
          evidence_class: string
          id: string
          nature: string
          provenance_id: string | null
          source: string | null
          tenant_id: string
          timestamp: string
          title: string
        }
        Insert: {
          case_id: string
          coordinates?: Json | null
          created_at?: string
          evidence_class?: string
          id?: string
          nature?: string
          provenance_id?: string | null
          source?: string | null
          tenant_id: string
          timestamp: string
          title: string
        }
        Update: {
          case_id?: string
          coordinates?: Json | null
          created_at?: string
          evidence_class?: string
          id?: string
          nature?: string
          provenance_id?: string | null
          source?: string | null
          tenant_id?: string
          timestamp?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "timeline_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timeline_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_leases: {
        Row: {
          acquired_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          acquired_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          acquired_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_leases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_channels: {
        Row: {
          created_at: string
          display_label: string
          id: string
          ingest_enabled: boolean
          mode: string
          phone_number_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          display_label: string
          id?: string
          ingest_enabled?: boolean
          mode?: string
          phone_number_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          display_label?: string
          id?: string
          ingest_enabled?: boolean
          mode?: string
          phone_number_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_quote_outbox: {
        Row: {
          body: string
          created_at: string
          id: string
          snapshot_id: string
          state: string
          tenant_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          snapshot_id: string
          state?: string
          tenant_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          snapshot_id?: string
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_quote_outbox_snapshot_id_tenant_id_fkey"
            columns: ["snapshot_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "wa_quote_snapshots"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "wa_quote_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_quote_rates: {
        Row: {
          amount_minor: number
          batch_id: string
          created_at: string
          currency: string
          destination: string
          disclosure_approved: boolean
          equipment: string
          exclusions: string
          id: string
          max_kg: number
          min_kg: number
          origin: string
          source_reference: string
          tenant_id: string
          terms: string
          valid_from: string
          valid_to: string
          validity_hours: number
          vat_bps: number
          vat_treatment: string
          version: string
        }
        Insert: {
          amount_minor: number
          batch_id: string
          created_at?: string
          currency: string
          destination: string
          disclosure_approved: boolean
          equipment: string
          exclusions: string
          id?: string
          max_kg: number
          min_kg: number
          origin: string
          source_reference: string
          tenant_id: string
          terms: string
          valid_from: string
          valid_to: string
          validity_hours: number
          vat_bps: number
          vat_treatment: string
          version: string
        }
        Update: {
          amount_minor?: number
          batch_id?: string
          created_at?: string
          currency?: string
          destination?: string
          disclosure_approved?: boolean
          equipment?: string
          exclusions?: string
          id?: string
          max_kg?: number
          min_kg?: number
          origin?: string
          source_reference?: string
          tenant_id?: string
          terms?: string
          valid_from?: string
          valid_to?: string
          validity_hours?: number
          vat_bps?: number
          vat_treatment?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_quote_rates_batch_id_tenant_id_fkey"
            columns: ["batch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "wa_rate_batches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "wa_quote_rates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_quote_requests: {
        Row: {
          channel_id: string
          id: string
          provider_message_id: string
          provider_sent_at: string
          raw_sha256: string
          raw_text: string
          received_at: string
          sender_id: string
          tenant_id: string
        }
        Insert: {
          channel_id: string
          id?: string
          provider_message_id: string
          provider_sent_at: string
          raw_sha256: string
          raw_text: string
          received_at?: string
          sender_id: string
          tenant_id: string
        }
        Update: {
          channel_id?: string
          id?: string
          provider_message_id?: string
          provider_sent_at?: string
          raw_sha256?: string
          raw_text?: string
          received_at?: string
          sender_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_quote_requests_channel_id_tenant_id_fkey"
            columns: ["channel_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "wa_channels"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "wa_quote_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_quote_snapshots: {
        Row: {
          created_at: string
          draft_body: string
          engine_version: string
          id: string
          request_id: string
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          draft_body: string
          engine_version: string
          id?: string
          request_id: string
          snapshot: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          draft_body?: string
          engine_version?: string
          id?: string
          request_id?: string
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_quote_snapshots_request_id_tenant_id_fkey"
            columns: ["request_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "wa_quote_requests"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "wa_quote_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_rate_batches: {
        Row: {
          created_at: string
          created_by: string
          id: string
          source_sha256: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          source_sha256: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          source_sha256?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_rate_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_rate_revocations: {
        Row: {
          batch_id: string
          id: string
          reason: string
          revoked_at: string
          revoked_by: string
          tenant_id: string
        }
        Insert: {
          batch_id: string
          id?: string
          reason: string
          revoked_at?: string
          revoked_by: string
          tenant_id: string
        }
        Update: {
          batch_id?: string
          id?: string
          reason?: string
          revoked_at?: string
          revoked_by?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_rate_revocations_batch_id_tenant_id_fkey"
            columns: ["batch_id", "tenant_id"]
            isOneToOne: false
            referencedRelation: "wa_rate_batches"
            referencedColumns: ["id", "tenant_id"]
          },
          {
            foreignKeyName: "wa_rate_revocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_tenant_invitation: { Args: { p_token: string }; Returns: string }
      acquire_upload_slot: {
        Args: {
          p_global_max: number
          p_tenant_id: string
          p_tenant_max: number
          p_ttl_seconds: number
        }
        Returns: string
      }
      admin_get_ai_health: { Args: never; Returns: Json }
      admin_get_dispute: { Args: { p_id: string }; Returns: Json }
      admin_list_cases: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_disputes: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_health_email_sends: {
        Args: { p_days?: number }
        Returns: Json
      }
      admin_list_tenant_free_caps: { Args: never; Returns: Json }
      admin_list_tenant_upload_concurrency: {
        Args: never
        Returns: {
          max_concurrent: number
          tenant_id: string
          updated_at: string
        }[]
      }
      admin_list_tenants: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      admin_list_users: {
        Args: { p_cursor?: string; p_limit?: number }
        Returns: Json
      }
      admin_set_tenant_free_cap: {
        Args: { p_daily_attempts: number; p_tenant_id: string }
        Returns: Json
      }
      admin_set_tenant_upload_concurrency: {
        Args: { p_max: number; p_tenant_id: string }
        Returns: undefined
      }
      approve_evidence_pack_atomic: {
        Args: { _case_id: string; _pack_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          canonical_payload: string | null
          case_id: string
          generated_at: string
          id: string
          pack_payload: Json
          sha256_hash: string
          status: string
          tenant_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "evidence_packs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cargoiq_cctv_tenant_ids: { Args: never; Returns: string[] }
      cargoiq_create_recovery_batch: {
        Args: { p_request: string; p_rows: Json; p_tenant: string }
        Returns: {
          actual_amount: number | null
          assigned_to: string | null
          calculation: Json
          case_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          evidence_refs: Json
          expected_amount: number | null
          finding_type: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          source_document_ids: string[]
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "recovery_findings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cargoiq_integrated_feature_readiness: { Args: never; Returns: Json }
      cargoiq_load_dd_draft: { Args: { p_case_id: string }; Returns: Json }
      cargoiq_risk_tenant_ids: { Args: never; Returns: string[] }
      cargoiq_save_dd_draft: {
        Args: { p_case_id: string; p_draft: Json; p_revision: number }
        Returns: Json
      }
      cases_with_unresolved_operational_clocks: {
        Args: { _case_ids: string[] }
        Returns: string[]
      }
      claim_health_email_day: {
        Args: { p_day: string; p_lease?: string }
        Returns: string
      }
      complete_extraction_cost: {
        Args: {
          p_case_id: string
          p_cost_usd: number
          p_document_id: string
          p_input_tokens: number
          p_model: string
          p_output_tokens: number
          p_provider: string
          p_request_id: string
          p_tenant_id: string
        }
        Returns: undefined
      }
      complete_health_email_day: {
        Args: { p_day: string; p_provider_message_id?: string }
        Returns: undefined
      }
      create_tenant_invitation: {
        Args: { p_email: string; p_role: string; p_tenant_id: string }
        Returns: Json
      }
      current_pack_source: { Args: { _case_id: string }; Returns: Json }
      delete_own_account: { Args: never; Returns: undefined }
      fail_health_email_day: {
        Args: { p_day: string; p_detail?: string }
        Returns: undefined
      }
      has_unresolved_operational_clocks: {
        Args: { _case_id: string }
        Returns: boolean
      }
      ingest_authorised_export: {
        Args: {
          p_authorization_basis: string
          p_case_id: string
          p_dataset: string
          p_exported_at: string
          p_raw_csv: string
          p_rows: Json
          p_source_document_id: string
          p_source_party: string
        }
        Returns: Json
      }
      is_platform_admin: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: { p_tenant_id: string }; Returns: boolean }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      list_tenant_invitations: { Args: { p_tenant_id: string }; Returns: Json }
      normalize_pack_source: { Args: { _source: Json }; Returns: Json }
      parse_export_csv: { Args: { p_text: string }; Returns: Json }
      persist_evidence_pack_atomic: {
        Args: { _canonical: string; _case_id: string }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          canonical_payload: string | null
          case_id: string
          generated_at: string
          id: string
          pack_payload: Json
          sha256_hash: string
          status: string
          tenant_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "evidence_packs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provision_organization: { Args: { org_name?: string }; Returns: string }
      reconcile_extraction_reservations: { Args: never; Returns: Json }
      release_upload_slot: { Args: { p_lease_id: string }; Returns: undefined }
      replace_pending_claims: {
        Args: {
          _case_id: string
          _claims: Json
          _document_id: string
          _replace_pending: boolean
        }
        Returns: Json
      }
      reserve_extraction_cost: {
        Args: {
          p_request_id: string
          p_reserved_cost_usd: number
          p_tenant_id: string
        }
        Returns: string
      }
      reserve_free_extraction_attempt: {
        Args: { p_daily_cap: number; p_tenant_id: string }
        Returns: string
      }
      revoke_tenant_invitation: {
        Args: { p_invitation_id: string }
        Returns: string
      }
      seed_demo_case: {
        Args: { _tenant: string; _user: string }
        Returns: string
      }
      verify_upload_lease: {
        Args: { p_lease_id: string; p_tenant_id: string; p_ttl_seconds: number }
        Returns: boolean
      }
      void_extraction_reservation: {
        Args: { p_request_id: string; p_tenant_id: string }
        Returns: undefined
      }
      wa_current_rate_rows: {
        Args: { p_tenant: string }
        Returns: {
          amount_minor: number
          batch_id: string
          created_at: string
          currency: string
          destination: string
          disclosure_approved: boolean
          equipment: string
          exclusions: string
          id: string
          max_kg: number
          min_kg: number
          origin: string
          source_reference: string
          tenant_id: string
          terms: string
          valid_from: string
          valid_to: string
          validity_hours: number
          vat_bps: number
          vat_treatment: string
          version: string
        }[]
        SetofOptions: {
          from: "*"
          to: "wa_quote_rates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      wa_import_rates: {
        Args: { p_rates: Json; p_sha256: string; p_tenant: string }
        Returns: string
      }
      wa_is_admin: { Args: { t: string }; Returns: boolean }
      wa_receive_test: {
        Args: {
          p_channel: string
          p_message: string
          p_sender: string
          p_sent: string
          p_sha: string
          p_text: string
        }
        Returns: string
      }
      wa_revoke_rate_batch: {
        Args: { p_batch: string; p_reason: string; p_tenant: string }
        Returns: string
      }
      wa_save_test_snapshot: {
        Args: {
          p_draft: string
          p_engine: string
          p_request: string
          p_snapshot: Json
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "investigator" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "investigator", "viewer"],
    },
  },
} as const
