// src/lib/mail.ts
// vm_admin: sending email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// A plain HTTPS call, no package. Settings: RESEND_API_KEY (a "Sending access"
// key), MAIL_FROM ("VideoMind <no-reply@mail.vidzmind.xyz>"). RESEND_API_URL
// is only for tests. Open and click tracking stay off in Resend.

export class MailError extends Error {
  constructor(message: string) { super(message); }
}

export function mailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY?.trim() && !!process.env.MAIL_FROM?.trim();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A short, plain message: a few paragraphs and at most one button. */
export interface Mail { to: string; subject: string; lines: string[]; button?: { label: string; url: string }; after?: string[] }

export function render(m: Mail): { html: string; text: string } {
  const p = (t: string) => `<p style="margin:0 0 14px;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1f1e">${esc(t)}</p>`;
  const btn = m.button
    ? `<p style="margin:22px 0"><a href="${esc(m.button.url)}" style="display:inline-block;background:#171a18;color:#f2cf4a;text-decoration:none;font:600 15px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:11px 18px;border-radius:6px">${esc(m.button.label)}</a></p>`
      + `<p style="margin:0 0 14px;font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#5d645e">Or open this address: ${esc(m.button.url)}</p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff">`
    + `<p style="margin:0 0 20px;font:600 16px -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#171a18">VideoMind</p>`
    + m.lines.map(p).join("") + btn + (m.after ?? []).map(p).join("")
    + `</body></html>`;
  const text = ["VideoMind", "", ...m.lines, ...(m.button ? ["", `${m.button.label}: ${m.button.url}`] : []), ...(m.after?.length ? ["", ...m.after] : [])].join("\n");
  return { html, text };
}

/** Send one email. Throws MailError when mail is not set up or Resend refuses it. */
export async function sendMail(m: Mail, idempotencyKey?: string): Promise<string> {
  const key = process.env.RESEND_API_KEY?.trim(), from = process.env.MAIL_FROM?.trim();
  if (!key || !from) throw new MailError("Email is not set up (RESEND_API_KEY and MAIL_FROM).");
  const url = process.env.RESEND_API_URL?.trim() || "https://api.resend.com/emails";
  const { html, text } = render(m);
  let r: Response;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
      body: JSON.stringify({ from, to: m.to, subject: m.subject, html, text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: any) {
    throw new MailError(`Resend could not be reached: ${err?.message ?? err}`);
  }
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Never log the key or the message body; the address is the admin's own.
    console.error(`[mail] Resend answered ${r.status}: ${body?.message ?? body?.name ?? "no detail"}`);
    throw new MailError(`Resend refused the email (${r.status}).`);
  }
  return String(body?.id ?? "");
}
