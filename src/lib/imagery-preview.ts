export function officialPreviewUrl(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "sentinel-cogs.s3.us-west-2.amazonaws.com" ||
    !/^\/sentinel-s2-l2a-cogs\/\d{1,2}\/[A-Z]\/[A-Z]{2}\/\d{4}\/\d{1,2}\/S2[ABC]_[A-Z0-9_]+\/preview\.jpg$/.test(
      url.pathname,
    ) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Invalid official overview asset");
  return url.href;
}
export async function readOverview(response: Response): Promise<Uint8Array> {
  if (
    !response.ok ||
    response.redirected ||
    !response.headers.get("content-type")?.startsWith("image/jpeg")
  )
    throw new Error("Overview image unavailable");
  if (Number(response.headers.get("content-length") || 0) > 250000)
    throw new Error("Overview image exceeds limit");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Overview image empty");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 250000) {
      await reader.cancel();
      throw new Error("Overview image exceeds limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes[bytes.length - 2] !== 255 ||
    bytes[bytes.length - 1] !== 217
  )
    throw new Error("Invalid JPEG overview");
  return bytes;
}
