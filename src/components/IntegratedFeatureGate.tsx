import { useEffect, useState, type ReactNode } from "react";
import { getIntegratedFeatureReadiness } from "@/lib/integrated-feature-gate.functions";
import { IntegratedFeatureUnavailable } from "@/components/IntegratedFeatureUnavailable";
export function IntegratedFeatureGate({ title, children }: { title: string; children: ReactNode }) {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    getIntegratedFeatureReadiness()
      .then((result) => {
        if (active) setReady(result.ready === true);
      })
      .catch(() => {
        if (active) setReady(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (ready === null)
    return (
      <p role="status" className="p-5 text-sm text-muted-foreground">
        Checking workspace safeguards...
      </p>
    );
  if (!ready) return <IntegratedFeatureUnavailable title={title} />;
  return <>{children}</>;
}
