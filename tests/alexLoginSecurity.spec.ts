import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { normalizePreregisteredLogin, resolvePreregisteredLogin } from "../lib/preregisteredLogin";

const app = readFileSync("components/ClubApp.tsx", "utf8");
const client = readFileSync("lib/clubPreregistration.ts", "utf8");
const store = readFileSync("lib/projectStore.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260914160000_secure_setup_login_routing.sql", "utf8");
const alexAccounts = [
  { id: "immutable-alex-ma", studentName: "Alex Ma", email: "alex.ma@example.test" },
  { id: "immutable-alex-li", studentName: "Alex Li", email: "alex.li@example.test" }
];

test("first-name collision warns but a unique normalized full name remains selected", () => {
  const result = resolvePreregisteredLogin(alexAccounts, " ＡＬＥＸ   ma ");
  expect(normalizePreregisteredLogin(" ＡＬＥＸ   ma ")).toBe("alex ma");
  expect(result.status).toBe("unique_exact");
  expect(result.firstNameMatches).toHaveLength(2);
  expect(result.selected?.id).toBe("immutable-alex-ma");
  expect(result.selected?.id).not.toBe("immutable-alex-li");
  expect(app).toContain("Other students share this first name, but this exact full username identifies one account.");
});

test("unique aliases resolve and duplicate exact identifiers remain ambiguous", () => {
  expect(resolvePreregisteredLogin([{ ...alexAccounts[0], loginAlias: "alex-ma-safe" }], "ALEX-MA-SAFE").selected?.id).toBe("immutable-alex-ma");
  expect(resolvePreregisteredLogin([
    { id: "one", studentName: "Alex Example" },
    { id: "two", studentName: "Ａｌｅｘ  Example" }
  ], "alex example").status).toBe("ambiguous");
  expect(migration).toContain("array_agg(distinct c.id order by c.id)");
  expect(migration).not.toMatch(/limit\s+1/i);
});

test("button and Enter share server-authoritative resolver and setup login routing", () => {
  expect(app).toContain('<form className="simple-form auth-form" onSubmit=');
  expect(app).toContain('<button type="submit" className="primary-button auth-submit"');
  expect(app).toContain("const fresh = await resolveLegacySetupIdentifier(identifier)");
  expect(app).toContain("if (allowPreregisteredName)");
  expect(client).toContain('supabase.rpc("parent_legacy_setup_identifier_status"');
  expect(client).toContain('supabase.rpc("parent_legacy_setup_login"');
});

test("legacy and current setup-required shapes use the same setup-only server gate", () => {
  expect(migration).toContain("not coalesce((v_row.values->>'profileSetupRequired')::boolean,false)");
  expect(migration).not.toContain("if not coalesce((v_row.values->>'clubPreregistered')::boolean,false) or not coalesce((v_row.values->>'profileSetupRequired')::boolean,false)");
  expect(migration).toContain("'setupOnly',true");
  expect(migration).toContain("interval '15 minutes'");
  expect(migration).toContain(">=8");
});

test("password replacement must differ and revokes every setup session", () => {
  expect(migration).toContain("v_old_candidate=v_old_hash");
  expect(migration).toContain("A different password is required");
  expect(migration).toContain("set revoked_at=clock_timestamp() where s.account_id=v_row.id and s.revoked_at is null");
  expect(migration).toContain("'profileSetupRequired',false");
  expect(migration).toContain("'previousCredentialInvalidated',true");
});

test("pre-auth startup does not load or subscribe to broad project rows", () => {
  const startup = app.slice(app.indexOf("useEffect(() => {\n    const storedVerifiedSession"), app.indexOf("  return (\n    <main", app.indexOf("useEffect(() => {\n    const storedVerifiedSession")));
  expect(startup).not.toContain("loadAll();");
  expect(startup).not.toContain("postgres_changes");
  expect(startup).toContain("Never trust the old localStorage-only Club marker");
});

test("account table reads and writes are RLS-denied while narrow RPCs strip secrets", () => {
  expect(migration).toContain("public read non-account project rows");
  expect(migration).toContain("project_table_id<>'8236c8f8-0fab-400c-bedc-143fd5930707'::uuid");
  expect(migration).toContain("r.values-'passwordHash'-'passwordSalt'-'confirmationCode'");
  expect(migration).toContain("revoke all on function public.parent_legacy_setup_identifier_status");
  expect(migration).toContain("grant execute on function public.parent_legacy_setup_identifier_status(text) to anon,authenticated");
  expect(store).toContain('supabase.rpc("parent_sync_authenticated_password"');
});

test("normal email flow remains routed through Supabase Auth and completed-profile RPC", () => {
  expect(store).toContain("supabase.auth.signInWithPassword");
  expect(store).toContain("supabase.auth.updateUser({ password })");
  expect(app).toContain("loginParentLegacySession(identifier, password)");
});
