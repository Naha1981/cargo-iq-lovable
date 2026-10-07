import { supabase } from "@/integrations/supabase/client";

// Single shared browser client so the session reaches server functions via the bearer attacher.
export function createClient() {
  return supabase;
}
