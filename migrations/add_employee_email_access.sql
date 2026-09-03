-- Employee Google login and system role access migration.
-- Run this in the Supabase SQL Editor for your project.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE employees ADD COLUMN IF NOT EXISTS system_role TEXT NOT NULL DEFAULT 'viewer';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_system_role_check'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_system_role_check
      CHECK (system_role IN ('viewer', 'editor', 'admin'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.current_user_org_role(target_org UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM organizations
      WHERE organizations.id = target_org
        AND organizations.employer_id = auth.uid()
    ) THEN 'owner'
    ELSE COALESCE((
      SELECT employees.system_role
      FROM employees
      WHERE employees.organization_id = target_org
        AND lower(employees.email) = lower(auth.jwt() ->> 'email')
      ORDER BY CASE employees.system_role
        WHEN 'admin' THEN 3
        WHEN 'editor' THEN 2
        WHEN 'viewer' THEN 1
        ELSE 0
      END DESC
      LIMIT 1
    ), 'none')
  END;
$$;

DROP POLICY IF EXISTS "Employers can view their own organizations" ON organizations;
DROP POLICY IF EXISTS "Owners and employees can view organizations" ON organizations;
CREATE POLICY "Owners and employees can view organizations"
  ON organizations FOR SELECT
  USING (public.current_user_org_role(id) <> 'none');

DROP POLICY IF EXISTS "Employers can manage employees in their organizations" ON employees;
DROP POLICY IF EXISTS "Owners and permitted employees can view employees" ON employees;
CREATE POLICY "Owners and permitted employees can view employees"
  ON employees FOR SELECT
  USING (public.current_user_org_role(organization_id) IN ('owner', 'viewer', 'editor', 'admin'));

DROP POLICY IF EXISTS "Owners and editors can insert employees" ON employees;
CREATE POLICY "Owners and editors can insert employees"
  ON employees FOR INSERT
  WITH CHECK (
    public.current_user_org_role(organization_id) IN ('owner', 'admin')
    OR (
      public.current_user_org_role(organization_id) = 'editor'
      AND system_role = 'viewer'
    )
  );

DROP POLICY IF EXISTS "Owners and editors can update employees" ON employees;
CREATE POLICY "Owners and editors can update employees"
  ON employees FOR UPDATE
  USING (public.current_user_org_role(organization_id) IN ('owner', 'editor', 'admin'))
  WITH CHECK (
    public.current_user_org_role(organization_id) IN ('owner', 'admin')
    OR (
      public.current_user_org_role(organization_id) = 'editor'
      AND system_role = 'viewer'
    )
  );

DROP POLICY IF EXISTS "Owners and admins can delete employees" ON employees;
CREATE POLICY "Owners and admins can delete employees"
  ON employees FOR DELETE
  USING (public.current_user_org_role(organization_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "Employers can manage roles in their organizations" ON roles;
DROP POLICY IF EXISTS "Owners and employee managers can manage roles" ON roles;
CREATE POLICY "Owners and employee managers can manage roles"
  ON roles FOR ALL
  USING (public.current_user_org_role(organization_id) IN ('owner', 'editor', 'admin'))
  WITH CHECK (public.current_user_org_role(organization_id) IN ('owner', 'editor', 'admin'));

-- If your project has an attendance table with organization_id, run this section too.
-- ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "Owners viewers and admins can view attendance" ON attendance;
-- CREATE POLICY "Owners viewers and admins can view attendance"
--   ON attendance FOR SELECT
--   USING (public.current_user_org_role(organization_id) IN ('owner', 'viewer', 'admin'));
--
-- DROP POLICY IF EXISTS "Owners and admins can manage attendance" ON attendance;
-- CREATE POLICY "Owners and admins can manage attendance"
--   ON attendance FOR ALL
--   USING (public.current_user_org_role(organization_id) IN ('owner', 'admin'))
--   WITH CHECK (public.current_user_org_role(organization_id) IN ('owner', 'admin'));
