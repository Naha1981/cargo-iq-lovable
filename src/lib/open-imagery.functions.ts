import { readCatalogue } from "./catalogue-response";
import { officialPreviewUrl, readOverview } from "@/lib/imagery-preview";
import { createServerFn } from "@tanstack/react-start";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { imagerySearchInput, parseOpenImagery } from "@/lib/open-imagery";

/** Fixed public provider only. Never accepts arbitrary asset URLs or downloads COGs. */
export const searchOpenImagery = createServerFn({ method: "GET" })
  .validator(imagerySearchInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: caseRow, error } = await context.supabase
      .from("cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error || !caseRow) throw new Error("Case unavailable in this workspace");
    const day = new Date(data.date + "T00:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== data.date)
      throw new Error("Invalid complete date");
    const end = new Date(day.getTime() + 86400000).toISOString();
    const url = new URL("https://earth-search.aws.element84.com/v1/search");
    url.searchParams.set("collections", "sentinel-2-l2a");
    url.searchParams.set(
      "bbox",
      [
        data.longitude - 0.001,
        data.latitude - 0.001,
        data.longitude + 0.001,
        data.latitude + 0.001,
      ].join(","),
    );
    url.searchParams.set("datetime", day.toISOString() + "/" + end);
    url.searchParams.set("limit", "12");
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "manual" });
    const body = await readCatalogue(response);
    return {
      retrievedAt: new Date().toISOString(),
      scenes: body.features.slice(0, 12).flatMap((item) => {
        const scene = parseOpenImagery(item, data.longitude, data.latitude);
        return scene ? [scene] : [];
      }),
    };
  });

// Same-origin authenticated relay avoids widening the app's image security policy.
// Only small official overview JPEGs are accepted; no arbitrary URLs or COG reads.
export const loadOpenImageryPreview = createServerFn({ method: "GET" })
  .validator((input: { url: string }) => ({ url: officialPreviewUrl(input.url) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data }) => {
    const response = await fetch(data.url, {
      signal: AbortSignal.timeout(15000),
      redirect: "manual",
    });
    const bytes = Buffer.from(await readOverview(response));
    return {
      dataUri: "data:image/jpeg;base64," + bytes.toString("base64"),
      retrievedAt: new Date().toISOString(),
    };
  });
