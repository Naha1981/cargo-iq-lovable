import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(path, "utf8");
describe("case navigation cache safety", () => {
  it("loads one tenant-protected workspace at the parent, with bounded freshness", () => {
    const parent = source("src/routes/cases.$caseId.tsx");
    expect(parent).toContain("staleTime: 30_000");
    expect(parent).toContain("getCaseWorkspace({ data: { caseId: params.caseId } })");
    expect(parent).not.toContain("beforeLoad:");
    expect(source("src/lib/case.functions.ts").replace(/\s+/g, "")).toContain(
      'export const getCaseWorkspace = createServerFn({ method: "GET" }).validator(idInput).middleware([tenantMiddleware])'.replace(/\s+/g, ""),
    );
    expect(source("src/lib/auth-middleware.ts")).toContain("await getAuthed()");
  });
  it("shares the parent snapshot across tabs instead of repeating workspace calls", () => {
    for (const tab of ["index", "map", "documents", "financials", "pack"]) {
      const child = source(`src/routes/cases.$caseId.${tab}.tsx`);
      expect(child).toContain("CaseRoute.useLoaderData()");
      expect(child).not.toContain("loader:");
    }
  });
  it("invalidates the shared snapshot after every tab mutation", () => {
    for (const tab of ["map", "documents", "financials", "pack"]) {
      expect(source(`src/routes/cases.$caseId.${tab}.tsx`)).toContain("await router.invalidate()");
    }
  });
});

import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
it("reuses parent data across cached tab navigation and refetches on invalidation", async () => {
  let reads = 0;
  const root = createRootRoute();
  const parent = createRoute({
    getParentRoute: () => root,
    path: "/case/$id",
    staleTime: 30_000,
    loader: async () => ({ reads: ++reads }),
  });
  const a = createRoute({ getParentRoute: () => parent, path: "map" });
  const b = createRoute({ getParentRoute: () => parent, path: "financials" });
  const router = createRouter({
    routeTree: root.addChildren([parent.addChildren([a, b])]),
    history: createMemoryHistory({ initialEntries: ["/case/demo/map"] }),
  });
  await router.load();
  expect(reads).toBe(1);
  await (router.navigate as (options: any) => Promise<void>)({
    to: "/case/$id/financials",
    params: { id: "demo" },
  });
  expect(reads).toBe(1);
  await router.invalidate();
  expect(reads).toBe(2);
  await (router.navigate as (options: any) => Promise<void>)({
    to: "/case/$id/map",
    params: { id: "demo" },
  });
  expect(reads).toBe(2);
  await (router.navigate as (options: any) => Promise<void>)({
    to: "/case/$id/map",
    params: { id: "other" },
  });
  expect(reads).toBe(3);
});
