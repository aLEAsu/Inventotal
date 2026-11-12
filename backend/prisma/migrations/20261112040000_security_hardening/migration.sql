-- =============================================================
-- Endurecimiento de seguridad (portable: Postgres local, Docker y Supabase)
-- =============================================================
-- La API (NestJS + Prisma) es el único cliente de la base y se conecta con el rol dueño de las
-- tablas, que no queda sujeto a RLS. En Supabase el esquema public además se publica por la
-- API REST (PostgREST) a los roles anon/authenticated: sin estas reglas cualquiera con la clave
-- pública podría leer o modificar datos (incluidos los hashes de contraseña).

-- 1. RLS activo y sin políticas en todas las tablas: solo el rol dueño (la API) accede.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 2. Sin privilegios para los roles de la API pública de Supabase (si existen), también a futuro.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- 3. search_path fijo en las funciones de integridad (evita suplantación de objetos)
ALTER FUNCTION public.sigm_block_audit_mutation() SET search_path = public, pg_temp;
ALTER FUNCTION public.sigm_block_asset_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.sigm_block_delete() SET search_path = public, pg_temp;
ALTER FUNCTION public.sigm_protect_original_date() SET search_path = public, pg_temp;
