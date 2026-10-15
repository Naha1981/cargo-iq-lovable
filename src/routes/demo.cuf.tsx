import { createFileRoute } from "@tanstack/react-router";
import { CufDemo } from "@/components/CufDemo";
export const Route = createFileRoute("/demo/cuf")({
  head: () => ({ meta: [{ title: "CargoIQ | Sample review demo" }, { name: "robots", content: "noindex, nofollow" }] }),
  component: CufDemo,
});
