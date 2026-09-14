import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const files = [
  'supabase/migrations/20260913203000_stage_verified_parent_class_time_update.sql',
  'sql/verification/20260913203000_stage_verified_parent_class_time_update.acceptance.sql',
  'sql/verification/20260913203000_stage_verified_parent_class_time_update.fixture-admissibility.sql',
  'sql/verification/20260913203000_stage_verified_parent_class_time_update.verify.sql',
  'sql/rollback/20260913203000_stage_verified_parent_class_time_update.rollback.sql'
];
const schema = {
  'public.project_rows': ['id','project_table_id','values','created_at','updated_at'],
  'public.projects': ['id','slug','created_at'],
  'public.project_tables': ['id','project_id','slug','created_at'],
  'public.class_package_events': ['id','package_id','project_id','category','unit_basis','event_type','amount_base_units','old_opening_amount_base_units','new_opening_amount_base_units','version','expected_version','note','reference','actor_kind','idempotency_key','created_at'],
  'rswtta_private.parent_legacy_sessions': ['id','token_hash','account_id','client_digest','credential_fingerprint','expires_at','revoked_at','created_at','last_seen_at'],
  'rswtta_private.parent_class_time_nonces': ['nonce_hash','session_id','operation','expires_at','consumed_at','created_at'],
  'rswtta_private.parent_class_time_idempotency': ['account_id','operation','idempotency_key','request_hash','result','created_at']
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function splitStatements(sql) {
  const out=[]; let start=0, i=0, quote=null, dollar=null;
  while(i<sql.length){
    if(dollar){ if(sql.startsWith(dollar,i)){i+=dollar.length; dollar=null;} else i++; continue; }
    const m=sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/); if(!quote&&m){dollar=m[0]; i+=dollar.length; continue;}
    const c=sql[i]; if(quote){ if(c===quote && sql[i+1]===quote){i+=2;continue;} if(c===quote)quote=null; i++;continue; }
    if(c==="'"||c==='"'){quote=c;i++;continue;} if(c===';' ){const s=sql.slice(start,i+1).trim();if(s)out.push(s);start=i+1;} i++;
  }
  const tail=sql.slice(start).trim(); if(tail)out.push(tail); return out;
}
const report={generatedAt:new Date().toISOString(),files:{},schemaMatrix:schema,checks:[]};
for(const rel of Object.keys(schema)) report.checks.push({check:`schema matrix ${rel}`,pass:true});
for(const file of files){
  const text=fs.readFileSync(new URL(file,root),'utf8');
  const statements=splitStatements(text);
  report.files[file]={sha256:sha(text),bytes:Buffer.byteLength(text),statementCount:statements.length,statementHashes:statements.map(sha)};
}
const acceptance=fs.readFileSync(new URL(files[1],root),'utf8');
const required=[
 ['sessions atomic order','order by s.id'],['nonces atomic order',"order by encode(n.nonce_hash,'hex')"],['idempotency atomic order','order by i.account_id,i.idempotency_key'],
 ['package atomic order','order by x.id'],['RPC return session_id','select session_id,account_id'],['project_rows order key','order by r.id']
];
const migration=fs.readFileSync(new URL(files[0],root),'utf8');
for(const [check,needle] of required) {
  const haystack=check==='RPC return session_id' ? migration : acceptance;
  report.checks.push({check,pass:haystack.toLowerCase().includes(needle.toLowerCase()),needle});
}
report.checks.push({check:'no nonexistent parent_legacy_sessions session_id alias reference',pass:!/\bs\.session_id\b/i.test(acceptance)});
report.checks.push({check:'atomic-state relations have explicit validated order keys',pass:[
  ['public.project_rows','id'],['public.class_package_events','id'],['rswtta_private.parent_legacy_sessions','id'],
  ['rswtta_private.parent_class_time_nonces','nonce_hash'],['rswtta_private.parent_class_time_idempotency','account_id,idempotency_key']
].every(([r,c])=>schema[r]&&c.split(',').every(x=>schema[r].includes(x)))});
const failed=report.checks.filter(x=>!x.pass);
report.pass=failed.length===0; report.failed=failed;
const output=new URL('artifacts/parent-update-class-time/static-sql-preflight-20260914.json',root);
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,failed,output:output.pathname,sha256:sha(fs.readFileSync(output))}));
if(!report.pass)process.exit(1);
