import { describe, expect, it } from "vitest";

// Behavioral test of the getCaseRegisterPage query CONTRACT via a fake supabase
// that implements the exact chain used: select -> order x2 -> limit(n+1)
// -> or(search)? -> or(keyset)?, with multiple or() groups ANDed (PostgREST).
// The server fn itself needs the TanStack server runtime; here we verify the
// filter/cursor semantics the fn depends on.

function fakeCases(rows: any[]) {
  const ops: { ors: string[]; limitN: number | null } = { ors: [], limitN: null };
  const applyOr = (rs: any[], f: string) => {
    if (f.startsWith("reference_no.ilike.")) {
      const term = f.split(".ilike.")[1].split(",")[0].replace(/^%|%$/g, "").toLowerCase();
      return rs.filter((r) =>
        [r.reference_no, r.vessel_name, r.container_no, r.port_code].some((v) =>
          (v ?? "").toLowerCase().includes(term),
        ),
      );
    }
    const m = f.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/);
    if (m)
      return rs.filter((r) => r.created_at < m![1] || (r.created_at === m![2] && r.id < m![3]));
    throw new Error("unexpected or: " + f);
  };
  const builder: any = {
    or: (f: string) => {
      ops.ors.push(f);
      return builder;
    },
    then: (res: any, rej: any) => {
      let rs = [...rows].sort((a, b) =>
        b.created_at !== a.created_at
          ? b.created_at.localeCompare(a.created_at)
          : b.id < a.id
            ? -1
            : 1,
      );
      for (const f of ops.ors) rs = applyOr(rs, f);
      return Promise.resolve({ data: rs.slice(0, ops.limitN ?? rs.length), error: null }).then(
        res,
        rej,
      );
    },
  };
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            limit: (n: number) => {
              ops.limitN = n;
              return builder;
            },
          }),
        }),
      }),
    }),
  };
}

function mk(n: number, prefix = "c", overrides: any = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(4, "0")}`,
    created_at: new Date(Date.UTC(2026, 9, 1, 8, 0, 0) - i * 60000).toISOString(),
    reference_no: `DUR-2026-${String(i).padStart(4, "0")}`,
    vessel_name: i % 3 === 0 ? "MV Umhlanga Trader" : `Vessel ${i}`,
    container_no: `MSKU${i}`,
    port_code: "DUR",
    ...overrides,
  }));
}

// Mirror of the fn's page logic over the fake (lookahead + cursor extraction).
async function pageQuery(db: any, { q, cursor, limit }: any) {
  let query = db
    .from("cases")
    .select("*")
    .order()
    .order()
    .limit(limit + 1);
  if (q?.trim())
    query = query.or(`reference_no.ilike.%${q.trim()}%,vessel_name.ilike.%${q.trim()}%`);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  const { data } = await query;
  const page = (data ?? []).slice(0, limit);
  const nextCursor = (data ?? []).length > limit && page.length ? page[page.length - 1] : null;
  return { rows: page, nextCursor };
}

describe("register page query semantics", () => {
  it("lookahead limit+1 trims the page and exposes nextCursor from the last kept row", async () => {
    const db = fakeCases(mk(250));
    const p1 = await pageQuery(db, { limit: 100 });
    expect(p1.rows).toHaveLength(100);
    expect(p1.nextCursor?.id).toBe("c-0099");
    const p2 = await pageQuery(db, { limit: 100, cursor: p1.nextCursor });
    expect(p2.rows[0].id).toBe("c-0100");
    expect(p2.rows).toHaveLength(100);
    const p3 = await pageQuery(db, { limit: 100, cursor: p2.nextCursor });
    expect(p3.rows).toHaveLength(50);
    expect(p3.nextCursor).toBeNull();
  });

  it("search narrows to matching fields and combines with the keyset cursor (AND)", async () => {
    const db = fakeCases(mk(60));
    const p1 = await pageQuery(db, { q: "umhlanga", limit: 10 });
    expect(p1.rows.every((r: any) => r.vessel_name === "MV Umhlanga Trader")).toBe(true);
    expect(p1.rows).toHaveLength(10); // 20 matches (i%3==0), first page 10
    const p2 = await pageQuery(db, { q: "umhlanga", limit: 10, cursor: p1.nextCursor });
    expect(p2.rows).toHaveLength(10);
    expect(p2.nextCursor).toBeNull();
    const ids = new Set([...p1.rows, ...p2.rows].map((r: any) => r.id));
    expect(ids.size).toBe(20); // no overlap across pages
  });

  it("search with no matches returns an empty page and no cursor", async () => {
    const db = fakeCases(mk(5));
    const p = await pageQuery(db, { q: "zzz-no-match", limit: 100 });
    expect(p.rows).toHaveLength(0);
    expect(p.nextCursor).toBeNull();
  });
});
