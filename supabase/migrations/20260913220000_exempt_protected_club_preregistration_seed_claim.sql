-- Allow duplicate display names for protected Club preregistrations without weakening legacy seed claims.
begin;
select pg_advisory_xact_lock(hashtextextended('rswtta:club-unverified-legacy-preregistration:v1',0));
do $guard$ begin
 if encode(extensions.digest(convert_to(pg_get_functiondef('public.prevent_duplicate_student_account_seed()'::regprocedure),'UTF8'),'sha256'),'hex') <> '53c3204760a70724eb0009c8352f9d5915d52a3c6b0c4fc0fd5d486a25835540' then raise exception 'Legacy seed guard changed'; end if;
 if exists(select 1 from rswtta_private.club_preregistration_requests) then raise exception 'Refuse guard transition with active preregistration rows'; end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.prevent_duplicate_student_account_seed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_accounts_table_id constant uuid := '8236c8f8-0fab-400c-bedc-143fd5930707'::uuid;
  v_old_claim text;
  v_claim text;
  v_claim_label text;
  v_is_legacy_seed boolean;
begin
  if new.project_table_id <> v_accounts_table_id then
    return new;
  end if;

  -- New Club preregistrations use a protected UUID + login alias, not a legacy roster claim.
  -- The separate protection trigger rejects callers that try to forge this marker.
  if coalesce((new.values->>'clubPreregistered')::boolean, false) is true then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_claim := lower(regexp_replace(btrim(coalesce(old.values->>'preregisteredName', '')), '\s+', ' ', 'g'));
    v_claim := lower(regexp_replace(btrim(coalesce(new.values->>'preregisteredName', '')), '\s+', ' ', 'g'));
    if v_old_claim <> '' and v_claim is distinct from v_old_claim then
      raise exception 'Preregistered roster claim is immutable';
    end if;
    return new;
  end if;

  v_claim_label := regexp_replace(btrim(coalesce(nullif(new.values->>'preregisteredName', ''), new.values->>'studentName', '')), '\s+', ' ', 'g');
  v_claim := lower(v_claim_label);
  v_is_legacy_seed :=
    v_claim <> ''
    and btrim(coalesce(new.values->>'email', '')) = ''
    and btrim(coalesce(new.values->>'phone', '')) = ''
    and coalesce((new.values->>'profileSetupRequired')::boolean, false) is true;

  if not v_is_legacy_seed then
    return new;
  end if;

  -- Serialize every spelling claim before checking its immutable owner.
  perform pg_advisory_xact_lock(hashtextextended(v_accounts_table_id::text || ':' || v_claim, 0));

  if exists (
    select 1
    from public.project_rows existing
    where existing.project_table_id = v_accounts_table_id
      and lower(regexp_replace(btrim(coalesce(existing.values->>'preregisteredName', '')), '\s+', ' ', 'g')) = v_claim
      and coalesce((existing.values->>'profileSetupRequired')::boolean, true) is false
  ) then
    raise exception 'Preregistered roster entry already has a completed account';
  end if;

  -- Normalize stale seed payloads so the unique claim index also serializes
  -- clients that omit preregisteredName and send only studentName.
  new.values := jsonb_set(new.values, '{preregisteredName}', to_jsonb(v_claim_label), true);
  return new;
end;
$function$;

revoke all on function public.prevent_duplicate_student_account_seed() from public,anon,authenticated;
commit;
