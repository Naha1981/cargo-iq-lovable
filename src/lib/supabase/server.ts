import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";

export function createClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment variables are not configured.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
      setAll: (cookies: { name: string; value: string; options?: any }[], headers?: Record<string, string>) => {
        cookies.forEach(({ name, value, options }) => setCookie(name, value, options));
        Object.entries(headers ?? {}).forEach(([name, value]) => setResponseHeader(name, value));
      },
    },
  });
}
