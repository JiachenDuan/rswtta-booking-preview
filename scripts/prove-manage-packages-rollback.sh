#!/bin/sh
set -eu

: "${MANAGE_PACKAGES_DISPOSABLE_DATABASE_URL:?Set only to an approved local/disposable PostgreSQL database URL}"
: "${MANAGE_PACKAGES_DISPOSABLE_CONFIRM:?Set to exactly DISPOSABLE-NOT-PRODUCTION}"
[ "$MANAGE_PACKAGES_DISPOSABLE_CONFIRM" = "DISPOSABLE-NOT-PRODUCTION" ] || { echo "Refusing: disposable confirmation mismatch" >&2; exit 2; }
command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 2; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root/supabase/migrations/20260913043700_manage_class_packages.sql"
tmp=$(mktemp "${TMPDIR:-/tmp}/manage-packages-rollback.XXXXXX.sql")
trap 'rm -f "$tmp"' EXIT HUP INT TERM

python3 - "$migration" "$tmp" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
needle = "\ncommit;\n"
if source.count(needle) != 1 or not source.endswith(needle):
    raise SystemExit("migration must have exactly one terminal commit")
Path(sys.argv[2]).write_text(source[:-len(needle)] + "\nrollback;\n")
PY

printf 'migration_sha256=%s\n' "$(shasum -a 256 "$migration" | awk '{print $1}')"
psql "$MANAGE_PACKAGES_DISPOSABLE_DATABASE_URL" -v ON_ERROR_STOP=1 -X -f "$tmp"

remaining=$(psql "$MANAGE_PACKAGES_DISPOSABLE_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atqc "
select count(*) from (
  select to_regclass('public.class_package_keys')::text as object_name
  union all select to_regclass('public.class_package_events')::text
  union all select to_regprocedure('public.list_class_package_balances_v2()')::text
  union all select to_regprocedure('public.list_class_package_history(uuid,text)')::text
  union all select to_regprocedure('public.set_class_package_opening(uuid,text,text,integer,integer,bigint,text,text,uuid)')::text
  union all select to_regprocedure('public.resolve_class_package_consumption(jsonb)')::text
) objects where object_name is not null;")
[ "$remaining" = "0" ] || { echo "Rollback proof failed: $remaining v2 objects remain" >&2; exit 1; }
echo "rollback_proof=passed (all v2 objects absent)"
