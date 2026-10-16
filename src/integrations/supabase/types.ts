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
      cases: {
        Row: {
          container_no: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      current_pack_source: { Args: { _case_id: string }; Returns: Json }
      has_unresolved_operational_clocks: {
        Args: { _case_id: string }
        Returns: boolean
      }
      is_tenant_member: { Args: { _tenant_id: string }; Returns: boolean }
      normalize_pack_source: { Args: { _source: Json }; Returns: Json }
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
      seed_demo_case: {
        Args: { _tenant: string; _user: string }
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
