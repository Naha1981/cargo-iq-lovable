import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const R='/home/sandbox/cargo-iq-lovable/';
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;`);
try { await db.exec(fs.readFileSync(R+'drizzle/migrations/0000_cargoiq_core.sql','utf8')); } catch(e){ console.log('CORE ERR',e.message.slice(0,300)); process.exit(1);}
await db.exec(fs.readFileSync(R+'supabase/migrations/20261018190000_teams_and_workspaces.sql','utf8'));
await db.exec(fs.readFileSync(R+'supabase/migrations/20261018190000_teams_and_workspaces.sql','utf8')); // idempotent
console.log('migration applied twice OK');
const ids={};
for (const n of ['a','b','c']) { const r=await db.query(`insert into auth.users(email) values('${n}@x.test') returning id`); ids[n]=r.rows[0].id; }
const as=async(u,sql,params)=>{ await db.exec(`set app.uid='${ids[u]}'; set role authenticated`); try{ const r=await db.query(sql,params); return r.rows; } finally { await db.exec('reset role'); } };
const asAnon=async(sql,p)=>{ await db.exec(`set app.uid=''; set role anon`); try{ return (await db.query(sql,p)).rows;} finally{ await db.exec('reset role'); } };
const t=async(name,fn,expectFail)=>{ try{ const r=await fn(); console.log(expectFail?'FAIL(should have errored)':'PASS',name); return r;}catch(e){ console.log(expectFail?'PASS':'FAIL',name, expectFail?'-> '+e.message.slice(0,50):e.message); } };
const ta=(await as('a','select create_workspace($1) id',['Acme'])).at(0).id;
const tb=(await as('b','select provision_organization($1) id',['Beta'])).at(0).id;
const tok=(await as('a','select create_invite($1,$2) t',[ta,'viewer']))[0].t; console.log('token len',tok.length);
await t('B cannot create invite for A',()=>as('b','select create_invite($1,$2)',[ta,'viewer']),true);
await t('invite cannot grant admin',()=>as('a','select create_invite($1,$2)',[ta,'admin']),true);
console.log('anon invite_info', JSON.stringify(await asAnon('select * from invite_info($1)',[tok])));
console.log('anon bad token', JSON.stringify(await asAnon('select * from invite_info($1)',['nope'])));
await t('anon cannot accept',()=>asAnon('select accept_invite($1)',[tok]),true);
await t('C cannot list A members',()=>as('c','select * from list_members($1)',[ta]),true);
await t('C joins via token',()=>as('c','select accept_invite($1)',[tok]));
console.log('C workspaces', JSON.stringify(await as('c','select name,role from my_workspaces()')));
console.log('A members', (await as('a','select email,role from list_members($1)',[ta])).map(r=>r.email+':'+r.role).join(', '));
console.log('C sees A case', (await as('c','select count(*)::int n from cases where tenant_id=$1',[ta]))[0].n);
await t('viewer C cannot insert case',()=>as('c',`insert into cases(tenant_id,title) values($1,'x')`,[ta]),true);
await t('viewer C cannot update case',async()=>{ const r=await as('c',`update cases set title='hax' where tenant_id=$1 returning id`,[ta]); if(r.length) throw new Error('updated'); return r;} ,false);
console.log('C sees B case', (await as('c','select count(*)::int n from cases where tenant_id=$1',[tb]))[0].n);
await t('C cannot remove A',()=>as('c','select remove_member($1,$2)',[ta,ids.a]),true);
await t('C cannot promote self',()=>as('c','select set_member_role($1,$2,$3)',[ta,ids.c,'admin']),true);
await t('A cannot demote last admin',()=>as('a','select set_member_role($1,$2,$3)',[ta,ids.a,'viewer']),true);
await t('A cannot leave as last admin',()=>as('a','select remove_member($1,$2)',[ta,ids.a]),true);
await t('A promotes C to investigator',()=>as('a','select set_member_role($1,$2,$3)',[ta,ids.c,'investigator']));
await t('C (investigator) now inserts case',()=>as('c',`insert into cases(tenant_id,title,reference_no) values($1,'ok','R1')`,[ta]));
await as('a','select revoke_invite($1)',[ta]);
await t('revoked token rejected',()=>as('b','select accept_invite($1)',[tok]),true);
await t('A removes C',()=>as('a','select remove_member($1,$2)',[ta,ids.c]));
console.log('C sees A case after removal', (await as('c','select count(*)::int n from cases where tenant_id=$1',[ta]))[0].n);
await t('C cannot read invites table',()=>as('c','select * from tenant_invites',[]),true);
// rollback
await db.exec(fs.readFileSync(R+'supabase/rollback/20261018190000_teams_and_workspaces.down.sql','utf8'));
console.log('rollback OK; fn left:', (await db.query("select count(*)::int n from pg_proc where proname in ('create_invite','my_workspaces')")).rows[0].n);
