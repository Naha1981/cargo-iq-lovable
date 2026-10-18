import { getRequest } from "@tanstack/react-start/server";

export const WORKSPACE_COOKIE = "nl_workspace";

/** Server: read the workspace the user picked. Always re-checked against their memberships. */
export function requestedWorkspace(): string | null {
  const raw = getRequest()?.headers.get("cookie") ?? "";
  const m = raw.split(/;\s*/).find((p) => p.startsWith(WORKSPACE_COOKIE + "="));
  const v = m ? decodeURIComponent(m.slice(WORKSPACE_COOKIE.length + 1)) : "";
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

export function pickMembership<T extends { tenant_id: string }>(rows: T[] | null | undefined): T | null {
  if (!rows?.length) return null;
  const want = requestedWorkspace();
  return rows.find((r) => r.tenant_id === want) ?? rows[0] ?? null;
}
