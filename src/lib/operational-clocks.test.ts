import {describe,it,expect} from "vitest";
import {compareClocks,clockInput} from "./operational-clocks";
const r=(kind:string,t:string)=>({id:kind,physical_reference:"TRUCK-SYN-01",kind,timestamp_original:t,time_zone:"UTC",source_party:"Synthetic party",source_document_id:"doc",source_reference:"row 1"});
describe("three clock separation",()=>{
 it("shows queue and gate durations separately",()=>{const x=compareClocks([r("QUEUE_ARRIVAL","2026-10-14T06:00:00Z"),r("GATE_IN","2026-10-14T18:00:00Z"),r("GATE_OUT","2026-10-14T20:00:00Z")])[0];expect(x.results[0].hours).toBe(12);expect(x.results[1].hours).toBe(2);expect(x.results[2].status).toBe("MISSING")});
 it("withholds affected durations for competing times across organizations",()=>{const x=compareClocks([r("QUEUE_ARRIVAL","2026-10-14T06:00:00Z"),r("GATE_IN","2026-10-14T18:00:00Z"),{...r("GATE_IN","2026-10-14T19:00:00Z"),source_party:"Other organization"}])[0];expect(x.results[0].status).toBe("CONFLICTING");expect(x.results[0].hours).toBeNull()});
 it("compares instants, not display offsets",()=>{const x=compareClocks([r("QUEUE_ARRIVAL","2026-10-14T08:00:00+02:00"),r("GATE_IN","2026-10-14T06:00:00Z")])[0];expect(x.results[0].status).toBe("DERIVED");expect(x.results[0].hours).toBe(0)});
 it("preserves appointment lead/lag instead of pretending every value is late",()=>{const x=compareClocks([r("APPOINTMENT_START","2026-10-14T18:00:00Z"),r("GATE_IN","2026-10-14T17:00:00Z")])[0];expect(x.results[2].hours).toBe(-1)});
 it("rejects unknown timezone",()=>{expect(clockInput.safeParse({}).success).toBe(false)});
});

it("accepts evidenced source reconciliation only for the full reviewed snapshot",()=>{const rows=[{...r("GATE_IN","2026-10-14T18:00:00Z"),id:"a"},{...r("GATE_IN","2026-10-14T19:00:00Z"),id:"b"},r("GATE_OUT","2026-10-14T20:00:00Z")];const d={id:"decision",physical_reference:"TRUCK-SYN-01",kind:"GATE_IN",version:1,selected_clock_id:"a",considered_clock_ids:["a","b"]};expect(compareClocks(rows,[d])[0].results[1].hours).toBe(2);expect(compareClocks([...rows,{...r("GATE_IN","2026-10-14T19:30:00Z"),id:"c"}],[d])[0].results[1].status).toBe("CONFLICTING")});
