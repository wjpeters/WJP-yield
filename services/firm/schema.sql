CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wjp_api') THEN
    CREATE ROLE wjp_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE IF NOT EXISTS firm_entities (
  environment text NOT NULL, organization text NOT NULL, kind text NOT NULL,
  id text NOT NULL, data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY(environment,organization,kind,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS firm_dedup ON firm_entities
 (environment,organization,kind,(data->>'idempotency_key')) WHERE data ? 'idempotency_key';
CREATE TABLE IF NOT EXISTS firm_ledger (
  seq bigserial PRIMARY KEY, environment text NOT NULL, organization text NOT NULL,
  entry jsonb NOT NULL, previous_hash text NOT NULL, entry_hash text NOT NULL,
  UNIQUE(environment,organization,entry_hash)
);
CREATE OR REPLACE FUNCTION firm_artifact_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind IN ('strategy_version','dataset','backtest','strategy_review','report') THEN
    RAISE EXCEPTION 'Research artifacts are immutable; create a new version';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS firm_artifact_no_mutation ON firm_entities;
CREATE TRIGGER firm_artifact_no_mutation BEFORE UPDATE OR DELETE ON firm_entities FOR EACH ROW EXECUTE FUNCTION firm_artifact_immutable();
CREATE INDEX IF NOT EXISTS firm_ledger_scope ON firm_ledger(environment,organization,seq);
CREATE TABLE IF NOT EXISTS firm_leases (
  environment text NOT NULL, organization text NOT NULL, name text NOT NULL,
  owner text NOT NULL, fence bigint NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY(environment,organization,name)
);
CREATE OR REPLACE FUNCTION firm_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'WJP Journal is append-only. Corrections require new entries.'; END $$;
DROP TRIGGER IF EXISTS firm_no_mutation ON firm_ledger;
CREATE TRIGGER firm_no_mutation BEFORE UPDATE OR DELETE ON firm_ledger FOR EACH ROW EXECUTE FUNCTION firm_immutable();
DROP TRIGGER IF EXISTS firm_no_truncate ON firm_ledger;
CREATE TRIGGER firm_no_truncate BEFORE TRUNCATE ON firm_ledger FOR EACH STATEMENT EXECUTE FUNCTION firm_immutable();
CREATE OR REPLACE FUNCTION firm_append(p_entry jsonb) RETURNS firm_ledger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_env text; v_org text; v_previous text; v_entry jsonb; v_row firm_ledger;
BEGIN
  v_env := current_setting('wjp.environment');
  v_org := current_setting('wjp.organization');
  IF v_env='' OR v_org='' THEN RAISE EXCEPTION 'Missing scope'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_env || ':' || v_org || ':journal', 0));
  SELECT entry_hash INTO v_previous FROM public.firm_ledger
    WHERE environment=v_env AND organization=v_org ORDER BY seq DESC LIMIT 1;
  v_previous := coalesce(v_previous, repeat('0',64));
  v_entry := p_entry || jsonb_build_object('environment',v_env,'organization',v_org,
                 'timestamp',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                 'journal_id',gen_random_uuid()::text);
  INSERT INTO public.firm_ledger(environment,organization,entry,previous_hash,entry_hash)
    VALUES(v_env,v_org,v_entry,v_previous,encode(public.digest(v_previous || v_entry::text,'sha256'),'hex'))
    RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION firm_append(jsonb) FROM PUBLIC;
REVOKE ALL ON firm_ledger FROM PUBLIC, wjp_api;
GRANT SELECT ON firm_ledger TO wjp_api;
GRANT EXECUTE ON FUNCTION firm_append(jsonb) TO wjp_api;
GRANT SELECT,INSERT,UPDATE ON firm_entities,firm_leases TO wjp_api;
ALTER TABLE firm_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_entity_scope ON firm_entities;
CREATE POLICY firm_entity_scope ON firm_entities TO wjp_api USING
 (environment=current_setting('wjp.environment',true) AND organization=current_setting('wjp.organization',true))
 WITH CHECK (environment=current_setting('wjp.environment',true) AND organization=current_setting('wjp.organization',true));
DROP POLICY IF EXISTS firm_lease_scope ON firm_leases;
CREATE POLICY firm_lease_scope ON firm_leases TO wjp_api USING
 (environment=current_setting('wjp.environment',true) AND organization=current_setting('wjp.organization',true))
 WITH CHECK (environment=current_setting('wjp.environment',true) AND organization=current_setting('wjp.organization',true));
DROP POLICY IF EXISTS firm_ledger_scope_policy ON firm_ledger;
CREATE POLICY firm_ledger_scope_policy ON firm_ledger FOR SELECT TO wjp_api USING
 (environment=current_setting('wjp.environment',true) AND organization=current_setting('wjp.organization',true));
