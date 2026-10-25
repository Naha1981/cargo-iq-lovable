import { createClient } from "@supabase/supabase-js";

export function getServiceClient() {
  const url =
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("CCTV_SERVICE_ROLE_NOT_CONFIGURED");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getCctvEncryptionMasterKey() {
  const key = process.env.CARGOI_Q_CCTV_ENCRYPTION_KEY;
  if (!key) throw new Error("CCTV_ENCRYPTION_KEY_NOT_CONFIGURED");
  return key;
}
