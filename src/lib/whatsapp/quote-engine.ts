/** No network, AI, maps, or inferred market rates. All money is integer minor units. */
export const ENGINE_VERSION = 'lane-text-v1';
export const CITY_NAMES = { JHB: 'Johannesburg', DBN: 'Durban', CPT: 'Cape Town', PTA: 'Pretoria' } as const;
export type City = keyof typeof CITY_NAMES;
export type LaneRequest = { origin: City; destination: City; weightKg: number; equipment: 'TAUTLINER' };
export type ParsedRequest = { ok: true; value: LaneRequest } | { ok: false; code: 'EMPTY' | 'FORMAT' | 'SAME_CITY' | 'WEIGHT'; detail: string };
const aliases: Record<string, City> = { jhb:'JHB', johannesburg:'JHB', dbn:'DBN', durban:'DBN', cpt:'CPT', 'cape town':'CPT', pta:'PTA', pretoria:'PTA' };
const city = '(Johannesburg|Cape Town|Pretoria|Durban|JHB|DBN|CPT|PTA)';
const grammar = new RegExp('^(?:please\\s+)?(?:quote(?:\\s+for)?[ :]+)?'+city+'\\s*(?:to|->|→)\\s*'+city+'[,;\\s]+(\\d+(?:[.]\\d{1,3})?)\\s*(tonnes?|tons?|t|kilograms?|kgs?)[,;\\s]+(tautliner|taut liner)(?:[,.!]?\\s*please)?[.!]?$', 'i');
export function parseLaneText(raw: string): ParsedRequest {
  const text = raw.normalize('NFKC').trim().replace(/\s+/g,' ');
  if (!text) return {ok:false,code:'EMPTY',detail:'Enter a text request.'};
  if (text.length > 1000) return {ok:false,code:'FORMAT',detail:'Use one lane, load weight and equipment. Example: JHB to Durban, 10 tonnes, tautliner.'};
  const m = grammar.exec(text);
  if (!m) return {ok:false,code:'FORMAT',detail:'Use one supported city-to-city lane, load weight and tautliner. Extra stops, addresses, dates, hazardous loads and special instructions need human review. Example: JHB to Durban, 10 tonnes, tautliner.'};
  const origin=aliases[m[1].toLowerCase()],destination=aliases[m[2].toLowerCase()];
  if (origin===destination) return {ok:false,code:'SAME_CITY',detail:'Origin and destination must differ.'};
  const n=Number(m[3].replace(',','.'));
  const kilos=n*(/^(t|ton)/i.test(m[4])?1000:1);
  if (!Number.isSafeInteger(kilos)||kilos<=0||kilos>100000) return {ok:false,code:'WEIGHT',detail:'Weight must be a positive whole number of kilograms, at most 100 tonnes.'};
  return {ok:true,value:{origin,destination,weightKg:kilos,equipment:'TAUTLINER'}};
}
export type Rate = { id:string; batchId?:string; version:string; origin:City; destination:City; equipment:'TAUTLINER'; minKg:number; maxKg:number; amountMinor:number; currency:'ZAR'; vatTreatment:'INCLUDED'|'EXCLUDED'|'NOT_APPLICABLE'; vatBps:number; validFrom:string; validTo:string; validityHours:number; terms:string; exclusions:string; sourceReference:string; disclosureApproved:boolean };
export function validateRate(r: Rate): string[] {
  const errors:string[]=[];
  if(!r.id||!r.version?.trim()||r.version.length>80)errors.push('Rate ID and version required');
  if(!(r.origin in CITY_NAMES)||!(r.destination in CITY_NAMES)||r.origin===r.destination)errors.push('Unsupported or identical lane cities');
  if(r.equipment!=='TAUTLINER')errors.push('Unsupported equipment');
  if(!Number.isInteger(r.minKg)||!Number.isInteger(r.maxKg)||r.minKg<1||r.maxKg>100000||r.minKg>r.maxKg)errors.push('Invalid inclusive kg band');
  if(!Number.isSafeInteger(r.amountMinor)||r.amountMinor<1||r.amountMinor>1000000000)errors.push('Invalid amount_minor');
  if(r.currency!=='ZAR')errors.push('Only ZAR supported');
  if(!['INCLUDED','EXCLUDED','NOT_APPLICABLE'].includes(r.vatTreatment)||!Number.isInteger(r.vatBps)||r.vatBps<0||r.vatBps>3000||(r.vatTreatment==='NOT_APPLICABLE'&&r.vatBps!==0))errors.push('Explicit VAT treatment/rate required');
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(r.validFrom)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(r.validTo)||!Number.isFinite(Date.parse(r.validFrom))||!Number.isFinite(Date.parse(r.validTo))||Date.parse(r.validFrom)>=Date.parse(r.validTo)||new Date(r.validFrom).toISOString().slice(0,10)!==r.validFrom.slice(0,10)||new Date(r.validTo).toISOString().slice(0,10)!==r.validTo.slice(0,10))errors.push('Use increasing UTC ISO validity instants');
  if(!Number.isInteger(r.validityHours)||r.validityHours<1||r.validityHours>168)errors.push('Validity must be 1-168 hours');
  if(!r.terms?.trim()||!r.exclusions?.trim()||!r.sourceReference?.trim()||[r.terms,r.exclusions,r.sourceReference].some(x=>x.length>2000||/[\u0000-\u001f]/.test(x)))errors.push('Terms, exclusions and source reference required (plain one-line text)');
  if(r.disclosureApproved!==true)errors.push('Customer disclosure approval required');
  return errors;
}
export function overlapping(a: Rate,b: Rate): boolean {
  return a.origin===b.origin&&a.destination===b.destination&&a.equipment===b.equipment&&Math.max(a.minKg,b.minKg)<=Math.min(a.maxKg,b.maxKg)&&Math.max(Date.parse(a.validFrom),Date.parse(b.validFrom))<Math.min(Date.parse(a.validTo),Date.parse(b.validTo));
}
export type QuoteResult = {status:'QUOTE'; engineVersion:string; request:LaneRequest; rate:Rate; quotedAt:string; expiresAt:string; totalMinor:number; addedVatMinor:number} | {status:'NEEDS_REVIEW'|'NO_RATE'|'RATE_CONFLICT'; reason:string};
export function priceLane(request: LaneRequest, rates: Rate[], at: string): QuoteResult {
  const now=Date.parse(at); if(!Number.isFinite(now))throw new Error('INVALID_QUOTE_TIME');
  if(!(request.origin in CITY_NAMES)||!(request.destination in CITY_NAMES)||request.origin===request.destination||request.equipment!=='TAUTLINER'||!Number.isInteger(request.weightKg)||request.weightKg<1||request.weightKg>100000)return {status:'NEEDS_REVIEW',reason:'Unsupported request'};
  // Bad records are never silently ignored to select a cheaper one.
  const lane=rates.filter(r=>r.origin===request.origin&&r.destination===request.destination&&r.equipment===request.equipment);
  if(lane.some(r=>validateRate(r).length))return {status:'NEEDS_REVIEW',reason:'Invalid or undisclosable lane rate'};
  const matches=lane.filter(r=>request.weightKg>=r.minKg&&request.weightKg<=r.maxKg&&now>=Date.parse(r.validFrom)&&now<Date.parse(r.validTo));
  if(!matches.length)return {status:'NO_RATE',reason:'No current approved rate for this lane, weight and equipment'};
  if(matches.length!==1)return {status:'RATE_CONFLICT',reason:'Overlapping rates require admin review'};
  const rate=structuredClone(matches[0]);
  const addedVatMinor=rate.vatTreatment==='EXCLUDED'?Math.round(rate.amountMinor*rate.vatBps/10000):0;
  return {status:'QUOTE',engineVersion:ENGINE_VERSION,request:{...request},rate,quotedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+rate.validityHours*3600000,Date.parse(rate.validTo))).toISOString(),totalMinor:rate.amountMinor+addedVatMinor,addedVatMinor};
}
export function simulate(text:string,rates:Rate[],at:string) {
  const parsed=parseLaneText(text);return parsed.ok?{parsed,result:priceLane(parsed.value,rates,at)}:{parsed,result:null};
}
export function draftQuote(result: QuoteResult): string {
  if(result.status!=='QUOTE')return `DRAFT - NOT SENT. ${result.reason}.`;
  const money=(n:number)=>`ZAR ${(n/100).toFixed(2)}`;
  return `DRAFT - NOT SENT. Indicative lane rate: ${CITY_NAMES[result.request.origin]} to ${CITY_NAMES[result.request.destination]}, ${result.request.weightKg} kg, tautliner. ${money(result.totalMinor)} total. VAT: ${result.rate.vatTreatment.replaceAll('_',' ').toLowerCase()} (${(result.rate.vatBps/100).toFixed(2)}%). Terms: ${result.rate.terms}. Exclusions: ${result.rate.exclusions}. Valid until ${result.expiresAt}. Rate ${result.rate.version}. Subject to confirmation; no booking made.`;
}
