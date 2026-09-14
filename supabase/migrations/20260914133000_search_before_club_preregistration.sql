-- Mandatory search-before-create with atomic duplicate prevention.
-- Preserves the authorized legacy Club proof and does not broaden grants.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-search-preregister:v1',0));

do $guard$
declare v_project uuid; v_accounts uuid; v_bookings uuid; v_activity uuid; v_bills uuid; v_count bigint; v_hash text;
begin
 select p.id into strict v_project from public.projects p where p.id='ab9d8da3-762f-466c-b7ce-fa05088f03cd'::uuid and p.slug='rswtta-booking';
 select t.id into strict v_accounts from public.project_tables t where t.project_id=v_project and t.id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and t.slug='parent_accounts';
 select t.id into strict v_bookings from public.project_tables t where t.project_id=v_project and t.id='a7a8a308-2305-4ab6-ad20-5ce174558035'::uuid and t.slug='bookings';
 select t.id into strict v_activity from public.project_tables t where t.project_id=v_project and t.id='133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid and t.slug='activity_logs';
 select t.id into strict v_bills from public.project_tables t where t.project_id=v_project and t.id='47f053f4-af24-4e6c-a3ea-984f6bd36943'::uuid and t.slug='bill_notifications';
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id=v_accounts;
 if v_count<>67 or v_hash<>'d396f350b80f618777e38fea03da7e4edd8178c2fdb8e709505cb37f17e3c970' then raise exception 'Account baseline changed'; end if;
 select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id=v_bookings;
 if v_count<>2031 or v_hash<>'24600168527f67767eb244338a7a6c05cbf9daaa09cc236938aa1c5e5e04592a' then raise exception 'Booking baseline changed'; end if;
 select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id=v_activity;
 if v_count<>81 or v_hash<>'6e5939718e28b176c8e88ac006cda910878ed10a1c5af421aef145d35fb64391' then raise exception 'Activity baseline changed'; end if;
 select count(*),encode(extensions.digest(coalesce(string_agg(r.id::text,E'\n' order by r.id),''),'sha256'),'hex') into v_count,v_hash from public.project_rows r where r.project_table_id=v_bills;
 if v_count<>0 or v_hash<>'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' then raise exception 'Bill baseline changed'; end if;
 if to_regclass('rswtta_private.club_search_preregister_backup_20260914133000') is not null or to_regprocedure('public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean)') is not null then raise exception 'Migration already present'; end if;
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.club_preregister_student_v2(text,text,text,uuid,jsonb,text)'::regprocedure),'UTF8'),'sha256'),'hex')<>'8dccddab2f79a07cf0d44c9447f21a390835cd432eacf3a5d81c740748177037' then raise exception 'Active preregistration authority changed'; end if;
end $guard$;

create table rswtta_private.club_search_preregister_backup_20260914133000 as select r.* from public.project_rows r where r.project_table_id in('8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid);
alter table rswtta_private.club_search_preregister_backup_20260914133000 enable row level security;
revoke all on rswtta_private.club_search_preregister_backup_20260914133000 from public,anon,authenticated;
comment on table rswtta_private.club_search_preregister_backup_20260914133000 is 'Private rollback-only preregistration backup; never browser-readable.';

-- Only durable credential claims get uniqueness. Names and phones remain non-unique.
create unique index project_rows_unique_parent_email_claim on public.project_rows(project_table_id,lower(normalize(btrim(values->>'email'),NFKC))) where project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and btrim(coalesce(values->>'email',''))<>'';
create unique index project_rows_unique_parent_login_alias_claim on public.project_rows(project_table_id,lower(normalize(regexp_replace(btrim(values->>'loginAlias'),'\s+',' ','g'),NFKC))) where project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and btrim(coalesce(values->>'loginAlias',''))<>'';

create function rswtta_private.club_preregistration_normalize_v2(p_input jsonb) returns jsonb language plpgsql immutable strict set search_path=pg_catalog as $$
declare v_name text:=normalize(regexp_replace(btrim(coalesce(p_input->>'studentName','')),'\s+',' ','g'),NFKC); v_email text:=lower(normalize(btrim(coalesce(p_input->>'email','')),NFKC)); v_phone text:=regexp_replace(normalize(btrim(coalesce(p_input->>'phone','')),NFKC),'[\s().-]+','','g'); v_alias text:=lower(normalize(regexp_replace(btrim(coalesce(p_input->>'loginAlias','')),'\s+',' ','g'),NFKC));
begin
 if char_length(v_name) not between 1 and 120 or v_name~'[[:cntrl:]]' then raise exception 'Invalid student name'; end if;
 if v_email<>'' and v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email'; end if;
 if v_phone<>'' and v_phone!~'^\+?[0-9]{7,20}$' then raise exception 'Invalid phone'; end if;
 if char_length(v_alias)>160 or v_alias~'[[:cntrl:]]' then raise exception 'Invalid login alias'; end if;
 return jsonb_build_object('studentName',v_name,'email',v_email,'phone',v_phone,'loginAlias',v_alias);
end $$;
create function rswtta_private.club_preregistration_version() returns jsonb language sql stable security definer set search_path=pg_catalog,public,extensions as $$ select jsonb_build_object('count',count(*),'maxUpdatedAt',coalesce(max(r.updated_at)::text,''),'idHash',encode(extensions.digest(coalesce(string_agg(r.id::text||':'||r.updated_at::text,E'\n' order by r.id),''),'sha256'),'hex')) from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid $$;
create function rswtta_private.club_preregistration_mask_email(p_value text) returns text language sql immutable set search_path=pg_catalog as $$ select case when position('@' in coalesce(p_value,''))>1 then left(split_part(p_value,'@',1),1)||'***@'||left(split_part(p_value,'@',2),1)||'***' else '' end $$;
create function rswtta_private.club_preregistration_mask_phone(p_value text) returns text language sql immutable set search_path=pg_catalog as $$ select case when regexp_replace(coalesce(p_value,''),'[^0-9]','','g')<>'' then '***'||right(regexp_replace(p_value,'[^0-9]','','g'),4) else '' end $$;
create function rswtta_private.club_preregistration_status(p_values jsonb) returns text language sql immutable set search_path=pg_catalog as $$ select case when coalesce((p_values->>'clubPreregistered')::boolean,false) and coalesce((p_values->>'profileSetupRequired')::boolean,false) then 'setup_required' when coalesce((p_values->>'confirmed')::boolean,false) then 'active' else 'unconfirmed' end $$;
create function rswtta_private.club_preregistration_proposed_id(p_request_key uuid) returns uuid language plpgsql immutable strict set search_path=pg_catalog,extensions as $$ declare v_hex text:=encode(extensions.digest(convert_to('rswtta-preregister-v3:'||p_request_key::text,'UTF8'),'sha256'),'hex'); begin return (substr(v_hex,1,8)||'-'||substr(v_hex,9,4)||'-4'||substr(v_hex,14,3)||'-a'||substr(v_hex,18,3)||'-'||substr(v_hex,21,12))::uuid; end $$;

create function rswtta_private.club_search_students_snapshot(p_query text) returns jsonb language plpgsql stable strict security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_query text:=rswtta_private.club_preregistration_alias(p_query); v_phone text:=regexp_replace(normalize(btrim(p_query),NFKC),'[\s().-]+','','g'); v_rows jsonb; v_version jsonb; v_hash text;
begin
 if char_length(v_query) not between 1 and 160 then raise exception 'Search query required'; end if;
 select coalesce(jsonb_agg(s.result order by s.rank,s.student_name,s.account_id),'[]'::jsonb) into v_rows from (
  select r.id account_id,coalesce(r.values->>'studentName','') student_name,case when rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=v_query then 0 when left(r.id::text,8)=v_query then 1 else 2 end rank,
   jsonb_build_object('accountId',r.id,'shortId',left(r.id::text,8),'studentName',coalesce(r.values->>'studentName',''),'maskedEmail',rswtta_private.club_preregistration_mask_email(r.values->>'email'),'maskedPhone',rswtta_private.club_preregistration_mask_phone(r.values->>'phone'),'status',rswtta_private.club_preregistration_status(r.values)) result
  from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and (rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) like '%'||v_query||'%' or rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias','')) like '%'||v_query||'%' or lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC)) like '%'||v_query||'%' or (v_phone<>'' and regexp_replace(normalize(btrim(coalesce(r.values->>'phone','')),NFKC),'[\s().-]+','','g') like '%'||v_phone||'%') or left(r.id::text,8)=v_query)
  order by rank,student_name,r.id limit 12
 ) s;
 v_version:=rswtta_private.club_preregistration_version(); v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('query',v_query,'results',v_rows,'version',v_version)::text,'UTF8'),'sha256'),'hex');
 return jsonb_build_object('normalizedQuery',v_query,'snapshotHash',v_hash,'collisionVersion',v_version,'results',v_rows);
end $$;

create function rswtta_private.club_preregistration_preview_v2(p_input jsonb,p_request_key uuid) returns jsonb language plpgsql stable strict security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_safe jsonb:=rswtta_private.club_preregistration_normalize_v2(p_input); v_name text:=rswtta_private.club_preregistration_alias(v_safe->>'studentName'); v_rows jsonb; v_version jsonb; v_hash text; v_proposed uuid:=rswtta_private.club_preregistration_proposed_id(p_request_key);
begin
 select coalesce(jsonb_agg(jsonb_build_object('accountId',r.id,'studentName',r.values->>'studentName','maskedEmail',rswtta_private.club_preregistration_mask_email(r.values->>'email'),'maskedPhone',rswtta_private.club_preregistration_mask_phone(r.values->>'phone'),'status',rswtta_private.club_preregistration_status(r.values),'kinds',array_remove(array[case when rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=v_name then 'exact_name' when char_length(v_name)>=3 and (rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) like '%'||v_name||'%' or v_name like '%'||rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))||'%') then 'similar_name' end,case when v_safe->>'email'<>'' and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_safe->>'email' then 'email' end,case when v_safe->>'phone'<>'' and regexp_replace(normalize(btrim(coalesce(r.values->>'phone','')),NFKC),'[\s().-]+','','g')=v_safe->>'phone' then 'phone' end,case when v_safe->>'loginAlias'<>'' and rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias',''))=v_safe->>'loginAlias' then 'login_alias' end],null),'updatedAt',r.updated_at) order by r.id),'[]'::jsonb) into v_rows
 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and (rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))=v_name or (char_length(v_name)>=3 and (rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName','')) like '%'||v_name||'%' or v_name like '%'||rswtta_private.club_preregistration_alias(coalesce(r.values->>'studentName',''))||'%')) or (v_safe->>'email'<>'' and lower(normalize(btrim(coalesce(r.values->>'email','')),NFKC))=v_safe->>'email') or (v_safe->>'phone'<>'' and regexp_replace(normalize(btrim(coalesce(r.values->>'phone','')),NFKC),'[\s().-]+','','g')=v_safe->>'phone') or (v_safe->>'loginAlias'<>'' and rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias',''))=v_safe->>'loginAlias'));
 v_version:=rswtta_private.club_preregistration_version(); v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('normalized',v_safe,'proposedAccountId',v_proposed,'collisions',v_rows,'version',v_version)::text,'UTF8'),'sha256'),'hex');
 return jsonb_build_object('normalized',v_safe,'proposedAccountId',v_proposed,'snapshotHash',v_hash,'collisionVersion',v_version,'collisions',v_rows,'requiresSameNameReview',exists(select 1 from jsonb_array_elements(v_rows) c where c->'kinds' ? 'exact_name'));
end $$;

create function public.club_search_students(p_club_identifier text,p_club_proof text,p_client_key text,p_query text) returns jsonb language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$ begin perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key); return rswtta_private.club_search_students_snapshot(p_query); end $$;
create function public.club_preview_student_preregistration_v2(p_club_identifier text,p_club_proof text,p_client_key text,p_request_key uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,rswtta_private as $$ begin perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key); if p_request_key is null then raise exception 'Unique request key required'; end if; return rswtta_private.club_preregistration_preview_v2(p_input,p_request_key); end $$;

create function public.club_preregister_student_v3(p_club_identifier text,p_club_proof text,p_client_key text,p_request_key uuid,p_search_query text,p_search_snapshot_hash text,p_input jsonb,p_duplicate_snapshot_hash text,p_reviewed_same_name boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions,rswtta_private as $$
declare v_safe jsonb; v_request_hash bytea; v_existing rswtta_private.club_preregistration_requests%rowtype; v_search jsonb; v_preview jsonb; v_account uuid; v_activity uuid:=extensions.gen_random_uuid(); v_alias text; v_name text; v_result jsonb; v_credential rswtta_private.club_preregistration_temp_credential%rowtype; v_exact_name boolean; v_has_differentiator boolean;
begin
 perform rswtta_private.club_preregistration_verify_legacy_club(p_club_identifier,p_club_proof,p_client_key);
 if p_request_key is null or btrim(coalesce(p_search_query,''))='' then raise exception 'Completed search required'; end if;
 v_safe:=rswtta_private.club_preregistration_normalize_v2(p_input); v_name:=rswtta_private.club_preregistration_alias(v_safe->>'studentName'); v_account:=rswtta_private.club_preregistration_proposed_id(p_request_key);
 v_request_hash:=extensions.digest(convert_to(jsonb_build_object('input',v_safe,'searchQuery',rswtta_private.club_preregistration_alias(p_search_query),'sameNameReviewed',coalesce(p_reviewed_same_name,false))::text,'UTF8'),'sha256');
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-key:'||p_request_key::text,0)); select q.* into v_existing from rswtta_private.club_preregistration_requests q where q.request_key=p_request_key;
 if found then if v_existing.request_hash<>v_request_hash then raise exception 'Idempotency key payload mismatch'; end if; return v_existing.result||jsonb_build_object('replayed',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('club-preregister-search:'||rswtta_private.club_preregistration_alias(p_search_query),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-name:'||v_name,0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-email:'||coalesce(v_safe->>'email',''),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-phone:'||coalesce(v_safe->>'phone',''),0)); perform pg_advisory_xact_lock(hashtextextended('club-preregister-alias:'||coalesce(v_safe->>'loginAlias',''),0));
 v_search:=rswtta_private.club_search_students_snapshot(p_search_query); if v_search->>'snapshotHash' is distinct from p_search_snapshot_hash then raise exception 'Student search is stale'; end if;
 v_preview:=rswtta_private.club_preregistration_preview_v2(v_safe,p_request_key); if v_preview->>'snapshotHash' is distinct from p_duplicate_snapshot_hash then raise exception 'Duplicate preview is stale'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'email') then raise exception 'Email already belongs to an account'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'login_alias') then raise exception 'Login alias already belongs to an account'; end if;
 if exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'exact_name' and c->'kinds' ? 'phone') then raise exception 'Exact name and contact belong to an account'; end if;
 v_exact_name:=exists(select 1 from jsonb_array_elements(v_preview->'collisions') c where c->'kinds' ? 'exact_name'); v_has_differentiator:=(v_safe->>'loginAlias'<>'' or v_safe->>'email'<>'' or v_safe->>'phone'<>'');
 if v_exact_name and not v_has_differentiator then raise exception 'Exact name requires a unique alias or differentiator'; end if; if v_exact_name and not coalesce(p_reviewed_same_name,false) then raise exception 'Explicit same-name confirmation required'; end if;
 v_alias:=coalesce(nullif(v_safe->>'loginAlias',''),v_name); if v_exact_name or exists(select 1 from public.project_rows r where r.project_table_id='8236c8f8-0fab-400c-bedc-143fd5930707'::uuid and rswtta_private.club_preregistration_alias(coalesce(r.values->>'loginAlias',''))=v_alias) then v_alias:=case when v_safe->>'loginAlias'<>'' then v_safe->>'loginAlias' else v_name||'-'||left(v_account::text,8) end; end if;
 select c.* into strict v_credential from rswtta_private.club_preregistration_temp_credential c where c.singleton; perform set_config('rswtta.club_preregister_internal','on',true);
 insert into public.project_rows(id,project_table_id,values) values(v_account,'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,jsonb_build_object('studentName',v_safe->>'studentName','preregisteredName',v_safe->>'studentName','parentName','','email',v_safe->>'email','phone',v_safe->>'phone','loginAlias',v_alias,'passwordHash',encode(v_credential.password_hash,'base64'),'passwordSalt',encode(v_credential.salt,'base64'),'confirmationCode','','confirmed',false,'profileSetupRequired',true,'clubPreregistered',true,'credentialVersion',1));
 insert into rswtta_private.club_preregistration_aliases(normalized_alias,account_id) values(v_alias,v_account);
 insert into public.project_rows(id,project_table_id,values) values(v_activity,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid,jsonb_build_object('action','student_preregistered','message','One pending student preregistration was created.','studentName','','coach','','dateLabel','','timeLabel','','count',1,'accountId',v_account,'actor','club_unverified_legacy'));
 v_result:=jsonb_build_object('accountId',v_account,'activityId',v_activity,'loginAlias',v_alias,'replayed',false,'profileSetupRequired',true,'confirmed',false,'authority','club_unverified_legacy'); insert into rswtta_private.club_preregistration_requests(actor,request_key,request_hash,account_id,activity_id,result) values('club_unverified_legacy',p_request_key,v_request_hash,v_account,v_activity,v_result); return v_result;
end $$;

revoke all on all functions in schema rswtta_private from public,anon,authenticated;
revoke all on function public.club_search_students(text,text,text,text) from public,anon,authenticated;
revoke all on function public.club_preview_student_preregistration_v2(text,text,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.club_preregister_student_v2(text,text,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.club_search_students(text,text,text,text) to anon,authenticated;
grant execute on function public.club_preview_student_preregistration_v2(text,text,text,uuid,jsonb) to anon,authenticated;
grant execute on function public.club_preregister_student_v3(text,text,text,uuid,text,text,jsonb,text,boolean) to anon,authenticated;
revoke all on schema rswtta_private from public,anon,authenticated; revoke all on all tables in schema rswtta_private from public,anon,authenticated;

do $verify$ declare v_live_count bigint; v_backup_count bigint; v_live_hash text; v_backup_hash text;
begin
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.project_table_id,r.id),''),'sha256'),'hex') into v_live_count,v_live_hash from public.project_rows r where r.project_table_id in('8236c8f8-0fab-400c-bedc-143fd5930707'::uuid,'133ad2fa-44b2-4aab-ab5d-b79c563ab908'::uuid);
 select count(*),encode(extensions.digest(coalesce(string_agg(jsonb_build_object('id',r.id,'project_table_id',r.project_table_id,'values',r.values,'created_at',r.created_at,'updated_at',r.updated_at)::text,E'\n' order by r.project_table_id,r.id),''),'sha256'),'hex') into v_backup_count,v_backup_hash from rswtta_private.club_search_preregister_backup_20260914133000 r;
 if v_live_count<>v_backup_count or v_live_hash<>v_backup_hash then raise exception 'Fresh private backup mismatch'; end if;
 if has_table_privilege('anon','rswtta_private.club_search_preregister_backup_20260914133000','select') or has_table_privilege('authenticated','rswtta_private.club_search_preregister_backup_20260914133000','select') then raise exception 'Backup browser access was not denied'; end if;
end $verify$;
commit;
