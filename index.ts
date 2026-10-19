// Supabase Edge Function: submit-referral
// Public form endpoint: turn OFF "Verify JWT with legacy secret".
// Sends an email only. Does not save referrals into the database.
// Requires NAMECHEAP_SMTP_PASSWORD in Supabase Edge Function secrets.
import nodemailer from "npm:nodemailer@9";

const ALLOWED_ORIGINS = new Set([
  "https://worquers.com",
  "https://www.worquers.com",
]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 10000;

function respond(origin: string, status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      ...(ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

interface Referral {
  name: string;
  email: string;
  same_team: boolean;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    return respond(origin, 403, { ok: false, error: "Origin not allowed" });
  }
  if (request.method === "OPTIONS") return respond(origin, 200, { ok: true });
  if (request.method !== "POST") {
    return respond(origin, 405, { ok: false, error: "Method not allowed" });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return respond(origin, 415, { ok: false, error: "JSON required" });
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return respond(origin, 413, { ok: false, error: "Request too large" });
  }

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return respond(origin, 413, { ok: false, error: "Request too large" });
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw Error("Invalid");
    payload = parsed as Record<string, unknown>;
  } catch {
    return respond(origin, 400, { ok: false, error: "Invalid request" });
  }

  // The hidden form field is a basic bot trap, not full bot protection.
  if (text(payload.website, 100)) return respond(origin, 200, { ok: true });

  const applicantName = text(payload.applicant_name, 150);
  const applicantEmail = text(payload.applicant_email, 254);
  if (!applicantName || !EMAIL_PATTERN.test(applicantEmail) || payload.permission !== true) {
    return respond(origin, 400, { ok: false, error: "Enter your name, email and permission confirmation" });
  }
  if (!Array.isArray(payload.referrals) || payload.referrals.length < 1 || payload.referrals.length > 3) {
    return respond(origin, 400, { ok: false, error: "Enter 1 to 3 referrals" });
  }

  const referrals: Referral[] = [];
  const seen = new Set<string>();
  for (const raw of payload.referrals) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return respond(origin, 400, { ok: false, error: "Invalid referral" });
    }
    const entry = raw as Record<string, unknown>;
    const name = text(entry.name, 150);
    const email = text(entry.email, 254);
    if (!name || !EMAIL_PATTERN.test(email) || typeof entry.same_team !== "boolean" || seen.has(email.toLowerCase())) {
      return respond(origin, 400, { ok: false, error: "Check referral names and email addresses" });
    }
    seen.add(email.toLowerCase());
    referrals.push({ name, email, same_team: entry.same_team });
  }

  const smtpPassword = Deno.env.get("NAMECHEAP_SMTP_PASSWORD");
  if (!smtpPassword) {
    console.error("NAMECHEAP_SMTP_PASSWORD is missing");
    return respond(origin, 503, { ok: false, error: "Email service is temporarily unavailable" });
  }

  const message = [
    "NEW WORQUERS TECHNICIAN REFERRAL",
    `Submitted: ${new Date().toISOString()}`,
    "",
    "APPLICANT",
    `Full name: ${applicantName}`,
    `Email: ${applicantEmail}`,
    "",
    ...referrals.flatMap((referral, index) => [
      `TECHNICIAN ${index + 1}`,
      `Full name: ${referral.name}`,
      `Email: ${referral.email}`,
      `Would like to be on same team: ${referral.same_team ? "YES" : "NO"}`,
      "",
    ]),
    "Applicant confirmed permission to share these contact details.",
    "Note: A referral does not guarantee placement or assignment to the same team.",
  ].join("\n");

  try {
    const transporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 465,
      secure: true,
      auth: {
        user: "hire@worquers.com",
        pass: smtpPassword,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
    await transporter.sendMail({
      from: "Worquers Referrals <hire@worquers.com>",
      to: "join@worquers.com",
      replyTo: applicantEmail,
      subject: `New Worquers referrals — ${applicantName.replace(/[\r\n]/g, " ")}`,
      text: message,
    });
  } catch (error) {
    console.error("Referral notification failed", error);
    return respond(origin, 502, { ok: false, error: "Could not send referrals. Please try later." });
  }
  return respond(origin, 200, { ok: true });
});
