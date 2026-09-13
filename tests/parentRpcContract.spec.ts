import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const client = readFileSync("lib/parentClient.ts", "utf8");
const stageMigration = readFileSync("supabase/migrations/20260912211500_stage_opaque_parent_auth_and_future_cancellation.sql", "utf8");
const sql = [
  "supabase/migrations/20260912211500_stage_opaque_parent_auth_and_future_cancellation.sql",
  "supabase/migrations/20260912213000_activate_opaque_parent_and_club_sessions.sql"
].map((path) => readFileSync(path, "utf8")).join("\n");

function frontendContracts() {
  const contracts = new Map<string, Set<string>>();
  const callPattern = /supabase\.rpc\("([a-z0-9_]+)",\s*\{/g;
  for (let match = callPattern.exec(client); match; match = callPattern.exec(client)) {
    let depth = 1;
    let cursor = callPattern.lastIndex;
    while (cursor < client.length && depth > 0) {
      if (client[cursor] === "{") depth += 1;
      if (client[cursor] === "}") depth -= 1;
      cursor += 1;
    }
    const payload = client.slice(callPattern.lastIndex, cursor - 1);
    contracts.set(match[1], new Set([...payload.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map((item) => item[1])));
    callPattern.lastIndex = cursor;
  }
  return contracts;
}

function sqlArguments(functionName: string) {
  const declaration = new RegExp(`create(?: or replace)? function public\\.${functionName}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, "i").exec(sql);
  expect(declaration, `SQL function public.${functionName} must exist`).not.toBeNull();
  return new Set([...(declaration?.[1] ?? "").matchAll(/\b(p_[a-z0-9_]+)\s+[a-z]/gi)].map((item) => item[1].toLowerCase()));
}

test("every frontend Parent RPC has an exact staged SQL name and argument contract", () => {
  const contracts = frontendContracts();
  expect([...contracts.keys()].sort()).toEqual([
    "parent_cancel_booking_occurrences",
    "parent_complete_booking",
    "parent_complete_profile",
    "parent_issue_operation_nonce",
    "parent_request_booking",
    "parent_request_group_class",
    "parent_request_password_reset",
    "parent_session_login",
    "parent_session_logout",
    "parent_session_refresh",
    "parent_update_profile"
  ]);
  for (const [name, frontendArguments] of contracts) {
    expect([...sqlArguments(name)].sort(), `${name} argument names`).toEqual([...frontendArguments].sort());
  }
});

test("activation grants exactly the Parent browser RPCs used by the frontend", () => {
  for (const name of frontendContracts().keys()) {
    expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\(`, "i"));
  }
});

test("login alias seeding does not shadow SQL row aliases with a PL/pgSQL record", () => {
  const migrationBlock = /do \$migrate\$([\s\S]*?)end \$migrate\$;/.exec(stageMigration)?.[1] ?? "";
  expect(migrationBlock).toContain("v_account_row public.project_rows%rowtype");
  expect(migrationBlock).not.toMatch(/declare[^;]*\br\s+public\.project_rows%rowtype/i);
});
