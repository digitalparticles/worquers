-- Safe to run repeatedly. Keeps existing rows and columns.
ALTER TABLE public.crew_requests ADD COLUMN IF NOT EXISTS submission_details jsonb;
ALTER TABLE public.crew_requests ENABLE ROW LEVEL SECURITY;
-- Other columns were created in your previous successful SQL query.
-- This query reports any missing expected columns (should return zero rows):
WITH expected(name) AS (VALUES
('company_name'),('contact_name'),('contact_email'),('contact_phone'),('project_location'),
('start_date'),('duration_weeks'),('hours_per_week'),('technicians_needed'),('team_leads_needed'),
('foremen_needed'),('project_description'),('service_model'),('project_type'),('cable_types'),
('certifications_required'),('shift'),('working_days'),('overtime_required'),('start_date_flexible'),
('site_readiness'),('per_diem_amount'),('accommodation'),('travel_expenses'),('tools_provided_by'),
('site_access_requirements'),('employment_arrangement'),('additional_requirements'),('submission_details')
)
SELECT name AS missing_column FROM expected
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
WHERE c.table_schema='public' AND c.table_name='crew_requests' AND c.column_name=expected.name);
