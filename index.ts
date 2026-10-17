// Supabase Edge Function: submit-crew-request
// Deploy as a public function (JWT verification OFF).
// Before production rollout, add server-side rate limiting and bot mitigation.
// Keep the Supabase service role credential server-side only.
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://worquers.com", "https://www.worquers.com"]);
const MAX_BODY = 20_000;

function reply(data: Record<string, unknown>, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Vary": "Origin",
      ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Cache-Control": "no-store"
    }
  });
}

const str = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
const integer = (v: unknown, max: number) => {
  const s = str(v, 20);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n <= max ? n : null;
};
const money = (v: unknown) => {
  const s = str(v, 24);
  if (!s) return null;
  return /^(?:\d{1,5})(?:\.\d{1,2})?$/.test(s) ? Number(s) : null;
};
const cleanList = (v: unknown, maxItems = 15) =>
  Array.isArray(v) ? v.slice(0, maxItems).map(x => str(x, 100)).filter(Boolean) : [];

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (!allowedOrigins.has(origin)) return reply({ ok: false, error: "Origin not allowed." }, 403, origin);
  if (req.method === "OPTIONS") return reply({ ok: true }, 200, origin);
  if (req.method !== "POST") return reply({ ok: false, error: "Method not allowed." }, 405, origin);
  if (!req.headers.get("content-type")?.includes("application/json"))
    return reply({ ok: false, error: "JSON required." }, 415, origin);
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY)
    return reply({ ok: false, error: "Request too large." }, 413, origin);

  let input: Record<string, unknown>;
  try {
    const body = await req.text();
    if (body.length > MAX_BODY) return reply({ ok: false, error: "Request too large." }, 413, origin);
    input = JSON.parse(body);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error();
  } catch { return reply({ ok: false, error: "Invalid request." }, 400, origin); }

  const company = str(input.company_name, 180);
  const contact = str(input.contact_name, 180);
  const email = str(input.contact_email, 254);
  const phone = str(input.contact_phone, 50);
  const location = str(input.project_location, 200);
  const start = str(input.start_date, 10);
  const weeks = integer(input.duration_weeks, 260);
  const hours = integer(input.hours_per_week, 112);
  const tech = integer(input.technicians_needed, 1000);
  const leads = integer(input.team_leads_needed, 1000);
  const foremen = integer(input.foremen_needed, 1000);
  if (!company || !contact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !location ||
      !/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start)) ||
      weeks === null || weeks < 1 || hours === null || hours < 1 ||
      tech === null || leads === null || foremen === null ||
      (tech + leads + foremen === 0 && !str(input.other_roles))) {
    return reply({ ok: false, error: "Please check the required form fields." }, 400, origin);
  }
  const nullableBoolean = (v: unknown) => v === "true" ? true : v === "false" ? false : null;
  const overtime = nullableBoolean(input.overtime_required);
  const flexible = nullableBoolean(input.start_date_flexible);
  const perDiem = money(input.per_diem_amount);
  if ((str(input.overtime_required) && overtime === null) ||
      (str(input.start_date_flexible) && flexible === null) ||
      (str(input.per_diem_amount) && perDiem === null)) {
    return reply({ ok: false, error: "Please check the schedule and per diem fields." }, 400, origin);
  }
  const rates = [input.hourly_rate_technician, input.hourly_rate_team_lead, input.hourly_rate_foreman];
  if (rates.some(v => str(v) && money(v) === null))
    return reply({ ok: false, error: "Check the hourly rates." }, 400, origin);

  // Include the entire validated form in a private JSONB field, including
  // role-specific rates, work categories, shifts and benefits.
  const details = {
    service_model: str(input.service_model, 80),
    technician_years: integer(input.technician_years, 50),
    team_lead_years: integer(input.team_lead_years, 50),
    foreman_years: integer(input.foreman_years, 50),
    other_roles: str(input.other_roles),
    certifications: str(input.certifications),
    work_types: cleanList(input.work_types),
    project_type: str(input.project_type, 100),
    cable_details: str(input.cable_details),
    shift: str(input.shift, 100),
    working_days: str(input.working_days, 100),
    overtime_required: overtime,
    start_date_flexible: flexible,
    site_readiness: str(input.site_readiness, 100),
    contract_type: str(input.contract_type, 100),
    rate_basis: str(input.rate_basis, 100),
    hourly_rate_technician: money(input.hourly_rate_technician),
    hourly_rate_team_lead: money(input.hourly_rate_team_lead),
    hourly_rate_foreman: money(input.hourly_rate_foreman),
    perks: cleanList(input.perks),
    per_diem_amount: perDiem,
    accommodation: str(input.accommodation, 100),
    travel_expenses: str(input.travel_expenses, 100),
    tools_provided_by: str(input.tools_provided_by, 100),
    employment_arrangement: str(input.employment_arrangement, 100),
    certifications_required: str(input.certifications_required, 400),
    cable_types: str(input.cable_types, 400),
    site_access_requirements: str(input.site_access_requirements, 500),
    additional_requirements: str(input.additional_requirements, 2000),
    site_requirements: str(input.site_requirements),
    supervision: str(input.supervision, 100)
  };

  const url = Deno.env.get("SUPABASE_URL");
  // Use the current secret key format, with legacy service-role fallback.
  let serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) {
    try {
      const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
      serviceKey = typeof keys.default === "string" ? keys.default : "";
    } catch { /* handled below */ }
  }
  if (!url || !serviceKey) return reply({ ok: false, error: "Submission service not configured." }, 503, origin);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await supabase.from("crew_requests").insert({
    company_name: company,
    contact_name: contact,
    contact_email: email,
    contact_phone: phone,
    project_location: location,
    start_date: start,
    duration_weeks: weeks,
    hours_per_week: hours,
    technicians_needed: tech,
    team_leads_needed: leads,
    foremen_needed: foremen,
    project_description: str(input.project_description, 2000),
    // Dedicated hourly-rate columns are optional across existing schemas;
    // amounts are always retained in submission_details until column names
    // are verified directly against the live table.
    service_model: str(input.service_model, 80),
    project_type: str(input.project_type, 100),
    cable_types: str(input.cable_types, 400),
    certifications_required: str(input.certifications_required, 400),
    shift: str(input.shift, 100),
    working_days: str(input.working_days, 100),
    overtime_required: overtime,
    start_date_flexible: flexible,
    site_readiness: str(input.site_readiness, 100),
    per_diem_amount: perDiem,
    accommodation: str(input.accommodation, 100),
    travel_expenses: str(input.travel_expenses, 100),
    tools_provided_by: str(input.tools_provided_by, 100),
    site_access_requirements: str(input.site_access_requirements, 500),
    employment_arrangement: str(input.employment_arrangement, 100),
    additional_requirements: str(input.additional_requirements, 2000),
    submission_details: details
  });
  if (error) {
    console.error("Crew request database insert failed:", error.code, error.message);
    return reply({ ok: false, error: "Unable to save your request. Please try again later." }, 500, origin);
  }
  return reply({ ok: true }, 201, origin);
});
