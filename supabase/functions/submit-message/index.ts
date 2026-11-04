import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Public, unauthenticated: the "Contact Inani" form (portfolio.html) and the gallery's
// report/flag button. Same pattern as submit-feedback: log to the database, then open a
// GitHub issue on the repo so Chipper is notified.
//
// The repo is PUBLIC, so issues are alerts only. The sender's name/email/message and a
// reporter's details stay in contact_messages / content_reports, readable only through
// Admin -> Inbox. (When Resend is set up, emailing contact messages slots in here.)
//
// Reports: "I'm in this photo" and "this is my photo, posted without permission" hide the
// photo immediately pending review (consent first -- an admin can restore it). Any other
// reason hides it automatically once 3 different visitors have reported it.
//
// Request (JSON):
//   { kind: "contact", name, email, message, page?, website? }   (website = honeypot, must be empty)
//   { kind: "report", photo_id, about: "photo"|"caption", reason, details?, contact? }

const GITHUB_REPO_OWNER = "chippercantcode";
const GITHUB_REPO_NAME = "the-erebe";
const ADMIN_INBOX_URL = "https://erebe.art/admin.html#inbox";
const MAX_CONTACTS_PER_HOUR = 5;
const MAX_REPORTS_PER_HOUR = 10;
const AUTO_HIDE_AFTER_REPORTS = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REASON_LABELS: Record<string, string> = {
  inappropriate: "Inappropriate or offensive",
  me_in_photo: "I'm in this photo and want it taken down",
  my_photo_no_permission: "This is my photo, posted without my permission",
  spam: "Spam or unrelated",
  other: "Something else",
};
const HIDE_IMMEDIATELY = new Set(["me_in_photo", "my_photo_no_permission"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function clean(v: unknown, max: number) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const payload = await req.json();
    const kind = payload?.kind;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    async function openIssue(title: string, body: string) {
      const { data: secretRow } = await supabase
        .from("integration_secrets")
        .select("value")
        .eq("key", "github_issues_token")
        .maybeSingle();
      if (!secretRow?.value) return { error: "github_token_not_configured" };
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretRow.value}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "erebe-site-messages",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body }),
      });
      if (!res.ok) return { error: (await res.text()).slice(0, 500) };
      const issue = await res.json();
      return { number: issue.number as number, url: issue.html_url as string };
    }

    if (kind === "contact") {
      // Honeypot: real people never see or fill this field. Pretend success for bots.
      if (clean(payload.website, 200)) return json({ ok: true });

      const name = clean(payload.name, 200);
      const email = clean(payload.email, 320);
      const message = clean(payload.message, 5000);
      if (!name) return json({ error: "name_required" }, 400);
      if (!EMAIL_RE.test(email)) return json({ error: "email_invalid" }, 400);
      if (!message) return json({ error: "message_required" }, 400);

      const { count } = await supabase
        .from("contact_messages")
        .select("id", { count: "exact", head: true })
        .eq("submitter_ip", ip)
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= MAX_CONTACTS_PER_HOUR) {
        return json({ error: "rate_limited", detail: "Too many messages recently -- try again in a bit." }, 429);
      }

      const { data: row, error } = await supabase
        .from("contact_messages")
        .insert({ name, email, message, page: clean(payload.page, 200) || null, submitter_ip: ip })
        .select("id")
        .single();
      if (error || !row) return json({ error: "failed_to_save", detail: error?.message }, 500);

      const firstName = name.split(/\s+/)[0].slice(0, 40);
      const issue = await openIssue(
        `New message for Inani from ${firstName}`,
        [
          `Someone sent a message through the **Contact Inani** form on the portfolio page.`,
          `Read it and reply from **Admin → Inbox**: ${ADMIN_INBOX_URL}`,
          `_The sender's email and message are kept private in the database and are not posted here, because this repository is public. Close this issue once it's been answered._`,
          `---\n_Opened automatically by the erebe.art contact form._`,
        ].join("\n\n"),
      );
      if ("error" in issue) {
        await supabase.from("contact_messages").update({ error_message: issue.error }).eq("id", row.id);
      } else {
        await supabase
          .from("contact_messages")
          .update({ github_issue_number: issue.number, github_issue_url: issue.url })
          .eq("id", row.id);
      }
      // The message is saved either way, so the visitor sees success.
      return json({ ok: true });
    }

    if (kind === "report") {
      const photoId = clean(payload.photo_id, 64);
      const about = payload.about === "caption" ? "caption" : "photo";
      const reason = clean(payload.reason, 40);
      if (!UUID_RE.test(photoId)) return json({ error: "photo_not_found" }, 404);
      if (!REASON_LABELS[reason]) return json({ error: "reason_required" }, 400);

      const { data: photo } = await supabase.from("gallery_photos").select("*").eq("id", photoId).maybeSingle();
      if (!photo) return json({ error: "photo_not_found" }, 404);

      const { count } = await supabase
        .from("content_reports")
        .select("id", { count: "exact", head: true })
        .eq("reporter_ip", ip)
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= MAX_REPORTS_PER_HOUR) {
        return json({ error: "rate_limited", detail: "Too many reports recently -- try again in a bit." }, 429);
      }

      const { data: section } = await supabase.from("gallery_sections").select("title").eq("id", photo.section_id).maybeSingle();

      const { data: row, error } = await supabase
        .from("content_reports")
        .insert({
          gallery_photo_id: photoId,
          about,
          reason,
          details: clean(payload.details, 2000) || null,
          reporter_contact: clean(payload.contact, 320) || null,
          reporter_ip: ip,
          photo_snapshot: {
            caption: photo.caption,
            photographer: photo.photographer,
            uploader_name: photo.uploader_name,
            display_path: photo.display_path,
            section_title: section?.title ?? null,
            uploaded_at: photo.created_at,
          },
        })
        .select("id")
        .single();
      if (error || !row) return json({ error: "failed_to_save", detail: error?.message }, 500);

      // Decide whether to hide the photo now.
      let hidden = false;
      if (photo.status === "visible") {
        let shouldHide = HIDE_IMMEDIATELY.has(reason);
        if (!shouldHide) {
          const { data: open } = await supabase
            .from("content_reports")
            .select("reporter_ip")
            .eq("gallery_photo_id", photoId)
            .eq("status", "open");
          shouldHide = new Set((open || []).map((r) => r.reporter_ip)).size >= AUTO_HIDE_AFTER_REPORTS;
        }
        if (shouldHide) {
          await supabase
            .from("gallery_photos")
            .update({ status: "hidden", hidden_reason: `Auto-hidden after report: ${REASON_LABELS[reason]}`, updated_at: new Date().toISOString() })
            .eq("id", photoId);
          await supabase.from("content_reports").update({ auto_hidden: true }).eq("id", row.id);
          hidden = true;
        }
      }

      const issue = await openIssue(
        `Gallery report: a ${about} was flagged`,
        [
          `A visitor flagged a **${about}** in the gallery section **${section?.title ?? "(unknown)"}**.`,
          `Reason: **${REASON_LABELS[reason]}**`,
          hidden
            ? `The photo has been **hidden automatically** until an admin reviews it.`
            : photo.status === "hidden"
            ? `The photo was already hidden.`
            : `The photo is still visible.`,
          `Review it in **Admin → Inbox**: ${ADMIN_INBOX_URL}`,
          `_Report details and any contact info are kept private in the database and not posted here, because this repository is public._`,
          `---\n_Opened automatically by the erebe.art gallery report button._`,
        ].join("\n\n"),
      );
      if ("error" in issue) {
        await supabase.from("content_reports").update({ error_message: issue.error }).eq("id", row.id);
      } else {
        await supabase
          .from("content_reports")
          .update({ github_issue_number: issue.number, github_issue_url: issue.url })
          .eq("id", row.id);
      }
      return json({ ok: true, hidden });
    }

    return json({ error: "unknown_kind" }, 400);
  } catch (err) {
    return json({ error: "server_error", detail: String(err) }, 500);
  }
});
