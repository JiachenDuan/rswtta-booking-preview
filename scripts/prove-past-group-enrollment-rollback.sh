#!/bin/sh
set -eu
: "${PAST_GROUP_DISPOSABLE_DATABASE_URL:?Set an approved local/disposable PostgreSQL URL}"
: "${PAST_GROUP_DISPOSABLE_CONFIRM:?Set exactly DISPOSABLE-NOT-PRODUCTION}"
[ "$PAST_GROUP_DISPOSABLE_CONFIRM" = DISPOSABLE-NOT-PRODUCTION ] || { echo 'Refusing non-disposable target' >&2; exit 2; }
command -v psql >/dev/null 2>&1 || { echo 'psql is required' >&2; exit 2; }
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root/supabase/migrations/20260913093000_allow_past_single_group_enrollment.sql"
backup="$root/sql/backups/20260913093000_past_group_enrollment.private-backup.sql"
tmp=$(mktemp "${TMPDIR:-/tmp}/past-group-enrollment.XXXXXX.sql")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
python3 - "$migration" "$tmp" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text(); needle='\ncommit;\n'
if s.count(needle)!=1 or not s.endswith(needle): raise SystemExit('migration must have one terminal commit')
Path(sys.argv[2]).write_text(s[:-len(needle)]+'\nrollback;\n')
PY
psql "$PAST_GROUP_DISPOSABLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$backup"
before=$(psql "$PAST_GROUP_DISPOSABLE_DATABASE_URL" -X -Atqc "select md5(pg_get_functiondef(to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)')))")
psql "$PAST_GROUP_DISPOSABLE_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$tmp"
after=$(psql "$PAST_GROUP_DISPOSABLE_DATABASE_URL" -X -Atqc "select md5(pg_get_functiondef(to_regprocedure('public.add_student_to_group_occurrences(uuid,text,uuid,text,text,text,integer,jsonb,uuid)')))")
[ "$before" = "$after" ] || { echo 'terminal rollback did not restore function definition' >&2; exit 1; }
echo "rollback_proof=passed rpc_md5=$after"
