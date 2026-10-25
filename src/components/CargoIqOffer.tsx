import { SiteFooter } from "@/components/SiteFooter";

const pains = [
  {
    title: "Unshared processing data",
    answer: "Line up the authorized records that exist. Show the gap, not invented facts.",
    detail:
      "A source-linked case file keeps received documents and missing evidence distinct. CargoIQ cannot create access to withheld terminal data.",
  },
  {
    title: "Same event, different counts",
    answer: "Keep the original units and counting rules visible.",
    detail:
      "Four hatch-cover lifts may be one grouped operation. One truck may carry two boxes. Compare like with like only when the counting basis is agreed.",
  },
  {
    title: "KPIs that mean different things",
    answer: "Record the agreed definition and clock for each KPI.",
    detail:
      "First box off to last box on is a defined vessel clock, not a universal 18-hour rule. The benchmark must come from that vessel's agreement.",
  },
  {
    title: "Two hours inside, twelve outside",
    answer: "Separate queue arrival, appointment and gate events.",
    detail:
      "Show elapsed time under each supported starting point. A disputed gate-in time stays disputed instead of hiding the difference in one delay figure.",
  },
  {
    title: "The wrong party in a dispute",
    answer: "Show the issuer, parties and terms beside the events.",
    detail:
      "A shipping-line appointment and a claim against a terminal need different evidence. CargoIQ does not decide liability or whom to sue.",
  },
  {
    title: "Loopholes that stay open",
    answer: "Close the loop from a statement to its source and a reviewed result.",
    detail:
      "Claims, contradictions and an evidence-pack workflow exist in the app. An unresolved input must not become a definitive recovery figure.",
  },
];
export function CargoIqOffer({ firstRun = false }: { firstRun?: boolean }) {
  return (
    <>
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <section className={firstRun ? "pb-10 pt-10 md:pb-16" : "pb-16 pt-16 md:pb-24 md:pt-24"}>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
            {firstRun ? "Your first investigation" : "CargoIQ · Evidence & dispute intelligence"}
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">
            {firstRun
              ? "Start with one case. Make the evidence clear."
              : "Close the loop on disputed records."}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {firstRun
              ? "Bring the authorized records. Keep every party's definitions, clocks and unresolved questions visible. This is what CargoIQ is being built to help you prove."
              : "An evidence layer, not another tracking dashboard. Reconstruct a freight dispute when records are incomplete, counted differently or contested."}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={firstRun ? "/new-case" : "/auth?mode=signup"}
              className="inline-flex items-center rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
            >
              {firstRun ? "Create an investigation" : "Create an account"}
            </a>
            {!firstRun && (
              <a
                href="/auth"
                className="inline-flex items-center rounded-md border px-5 py-3 text-sm font-semibold"
              >
                Sign in
              </a>
            )}
            <a
              href="/demo/cuf"
              className="inline-flex items-center rounded-md border px-5 py-3 text-sm font-semibold"
            >
              Explore a worked example
            </a>
          </div>
        </section>
        <section className="border-t py-12 md:py-16" aria-labelledby="six-questions">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              The work, made explicit
            </p>
            <h2
              id="six-questions"
              className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl"
            >
              Six questions a case file should answer.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Open a question to see how CargoIQ answers it.
            </p>
          </div>
          <div className="mt-8 grid gap-x-10 md:grid-cols-2">
            {pains.map((p, i) => (
              <details key={p.title} className="group border-t py-6">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-start gap-4">
                    <span className="mt-1 font-mono text-xs text-muted-foreground">0{i + 1}</span>
                    <div className="flex-1">
                      <h3 className="text-lg font-medium">{p.title}</h3>
                      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                        {p.answer}
                      </p>
                    </div>
                    <span
                      aria-hidden="true"
                      className="text-xl text-muted-foreground group-open:rotate-45"
                    >
                      +
                    </span>
                  </div>
                </summary>
                <div className="ml-8 mt-4 max-w-lg">
                  <p className="text-sm leading-relaxed">{p.detail}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
        {!firstRun && (
          <section className="border-t py-12 md:py-16">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
                One operation. One closed case.
                <br />A result you can judge.
              </h2>
              <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                Agree scope, confidentiality, permitted records and sharing before receiving data.
                Reconstruct the case. Compare the result with your current tools. Review what
                helped, what did not and what to build next.
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                Parties judge the evidence. CargoIQ keeps its sources, methods, conflicts and limits
                visible.
              </p>
            </div>
          </section>
        )}
      </div>
      {!firstRun && <SiteFooter />}
    </>
  );
}
