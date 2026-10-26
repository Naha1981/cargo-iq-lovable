import { useMemo, useState } from "react";
import { Panel } from "@/components/ui-kit";
import {
  recordedImagery,
  compareRecordedImagery,
  type RecordedImagery,
} from "@/lib/imagery-comparison";
export function RecordedImageryComparison({ observations }: { observations: RecordedImagery[] }) {
  const scenes = useMemo(() => recordedImagery(observations), [observations]);
  const [a, setA] = useState(""),
    [b, setB] = useState("");
  const first = scenes.find((s) => s.id === a),
    second = scenes.find((s) => s.id === b);
  const result =
    first && second && first.id !== second.id ? compareRecordedImagery(first, second) : null;
  return (
    <Panel title="Recorded historical imagery coverage">
      <p className="mb-3 text-xs text-muted-foreground">
        Uses existing case observation records only. No provider request or paid API is invoked.
        Scene metadata is not pixel imagery or proof of a shipment's position, condition or delay.
      </p>
      {scenes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No recorded Sentinel scenes for this case. Historical comparison is unavailable until
          genuine provider records and suitable imagery are supplied.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [a, setA, "First scene"],
              [b, setB, "Second scene"],
            ].map(([value, set, label]) => (
              <label className="text-xs" key={label as string}>
                {label as string}
                <select
                  className="mt-1 w-full rounded border bg-background p-2"
                  value={value as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                >
                  <option value="">Select recorded scene</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sensor} · {s.acquiredAt ?? "acquisition time missing"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {a && a === b && (
            <p className="mt-2 text-xs text-amber-500">Select two different records.</p>
          )}
          {result && (
            <div className="mt-3 space-y-3">
              <ul className="list-inside list-disc text-xs text-amber-500">
                {result.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
              <div className="grid gap-3 md:grid-cols-2">
                {result.ordered.map((s) => (
                  <article className="space-y-1 rounded border p-3 text-xs" key={s.id}>
                    <h4 className="font-semibold">
                      {s.source} · {s.sensor}
                    </h4>
                    <p>Acquired: {s.acquiredAt ?? "not recorded"}</p>
                    <p>Record ingested: {s.created_at}</p>
                    <p className="break-all">
                      Provider identifier: {s.providerId ?? "not recorded"}
                    </p>
                    <p>
                      Cloud cover: {s.cloudPercent === null ? "not recorded" : s.cloudPercent + "%"}
                    </p>
                    <p>
                      Resolution: {s.resolutionM === null ? "not recorded" : s.resolutionM + "m"}
                    </p>
                    <p>Licence: {s.licence ?? "not recorded"}</p>
                    <p>Footprint: {s.bbox?.join(", ") ?? "not recorded"}</p>
                    <p className="break-all">Source reference: {s.sourceUrl ?? "not recorded"}</p>
                    <p>Limitations: {s.limitation ?? "not recorded"}</p>
                    <p className="text-muted-foreground">
                      Pixel comparison unavailable here. No thumbnail, damage detection or generated
                      replacement image is presented.
                    </p>
                  </article>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
