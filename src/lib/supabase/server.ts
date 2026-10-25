import {
  createClient as createSbClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import type { Database } from "@/integrations/supabase/types";

function env() {
  const url = process.env["SUPABASE_URL"] || import.meta.env.VITE_SUPABASE_URL;
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are not configured.");
  return { url, key };
}

function bearer(): string | null {
  const h = getRequest()?.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice(7);
  return t.split(".").length === 3 ? t : null;
}

/** Server client acting as the caller (bearer token attached by the client middleware). RLS applies. */
export function createClient(token: string | null = bearer()): SupabaseClient<Database> {
  const { url, key } = env();
  return createSbClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (token) h.set("Authorization", `Bearer ${token}`);
        else if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export async function getAuthed(): Promise<{
  supabase: SupabaseClient<Database>;
  user: User | null;
}> {
  const token = bearer();
  const supabase = createClient(token);
  if (!token) return { supabase, user: null };
  const { data, error } = await supabase.auth.getUser(token);
  return { supabase, user: error ? null : data.user };
}
