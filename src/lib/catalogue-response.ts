/** Bound provider bytes while streaming, before parsing or accumulating untrusted JSON. */
export async function readCatalogue(response: Response): Promise<{ features: unknown[] }> {
  if (!response.ok || response.redirected) throw new Error("Public imagery catalogue unavailable");
  if (!/^application\/(?:geo\+)?json(?:;|$)/i.test(response.headers.get("content-type") || ""))
    throw new Error("Invalid catalogue content type");
  const limit = 2000000;
  if (Number(response.headers.get("content-length") || 0) > limit)
    throw new Error("Catalogue response too large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty catalogue response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Catalogue response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || !("features" in body) || !Array.isArray(body.features))
    throw new Error("Invalid catalogue response");
  return { features: body.features };
}
