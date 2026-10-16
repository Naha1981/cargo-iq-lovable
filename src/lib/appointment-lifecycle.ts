import {z} from "zod";
const zoned=z.string().datetime({offset:true});
export const appointmentLifecycleInput=z.object({caseId:z.string().uuid(),appointmentReference:z.string().trim().min(3).max(200),physicalReference:z.string().trim().min(3).max(200),
 recordType:z.enum(["SLOT","ATTENDANCE","CANCELLATION","SYSTEM_FAILURE","RESPONSIBILITY_REVIEW"]),
 issuer:z.string().trim().min(2).max(200),party:z.string().trim().min(2).max(200),
 startAt:zoned.nullable(),endAt:zoned.nullable(),occurredAt:zoned,
 claimTarget:z.string().trim().max(200),outcome:z.enum(["NOT_ASSESSED","EVIDENCE_MISSING","CONTESTED","HUMAN_REVIEWED"]),
 explanation:z.string().trim().min(10).max(4000),termsReference:z.string().trim().min(3).max(2000),
 sourceDocumentId:z.string().uuid(),sourceReference:z.string().trim().min(3).max(1000),supersedesId:z.string().uuid().nullable(),
}).superRefine((r,c)=>{
 if(r.recordType==="SLOT"&&(!r.startAt||!r.endAt||Date.parse(r.endAt)<=Date.parse(r.startAt)))c.addIssue({code:"custom",path:["endAt"],message:"A slot requires start/end with offsets, end after start"});
 if(r.recordType!=="SLOT"&&(r.startAt||r.endAt))c.addIssue({code:"custom",path:["startAt"],message:"Only slot records contain a window"});
 if(r.recordType==="RESPONSIBILITY_REVIEW"&&(!r.claimTarget||r.outcome==="NOT_ASSESSED"))c.addIssue({code:"custom",path:["outcome"],message:"Name the claim target and an explicit review outcome"});
});
export type AppointmentLifecycle=z.infer<typeof appointmentLifecycleInput>&{id:string;version:number};
export function currentLifecycle(rows:AppointmentLifecycle[]){const superseded=new Set(rows.map(r=>r.supersedesId).filter(Boolean));return rows.filter(r=>!superseded.has(r.id));}
export function evaluateAppointment(rows:AppointmentLifecycle[]){
 const refs=[...new Set(rows.map(r=>r.appointmentReference))];return refs.map(reference=>{
 const history=rows.filter(r=>r.appointmentReference===reference),active=currentLifecycle(history),slots=active.filter(r=>r.recordType==="SLOT"),attendance=active.filter(r=>r.recordType==="ATTENDANCE");
 const physical=[...new Set(active.map(r=>r.physicalReference))];const reasons:string[]=[];
 if(physical.length!==1)reasons.push("Conflicting physical-visit identities");
 if(slots.length!==1)reasons.push(slots.length?"Conflicting current slot records":"Missing slot window");
 if(attendance.length!==1)reasons.push(attendance.length?"Conflicting attendance records":"Missing attendance evidence");
 const cancelled=active.some(r=>r.recordType==="CANCELLATION");if(cancelled)reasons.push("Cancellation recorded; window comparison needs review");
 const slot=slots[0],arrival=attendance[0];let timing:"EARLY"|"IN_WINDOW"|"LATE"|"WITHHELD"="WITHHELD",minutesLate:number|null=null;
 if(!reasons.length&&slot.startAt&&slot.endAt){const at=Date.parse(arrival.occurredAt),start=Date.parse(slot.startAt),end=Date.parse(slot.endAt);timing=at<start?"EARLY":at>end?"LATE":"IN_WINDOW";minutesLate=at>end?(at-end)/60000:0;}
 return {reference,history,active,timing,minutesLate,reasons,issuer:slot?.issuer??null,systemFailures:active.filter(r=>r.recordType==="SYSTEM_FAILURE"),reviews:active.filter(r=>r.recordType==="RESPONSIBILITY_REVIEW"),disclaimer:"Timing and appointment issuer do not establish fault or legal liability. Review the source-backed terms, changes and competing assertions."};
 });
}
