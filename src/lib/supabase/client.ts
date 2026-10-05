import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL || "https://c--5d4898c0-b107-4604-a530-da8960775175-prod.lovable.cloud";
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_9GFZ_Vdn8q7QmJf1fv2ATw_nv-whsAW";
  if (!url || !key) throw new Error("Supabase environment variables are not configured.");
  client = createBrowserClient(url, key);
  return client;
}
