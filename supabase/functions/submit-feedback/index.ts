import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GITHUB_REPO_OWNER = "chippercantcode";
const GITHUB_REPO_NAME = "the-erebe";
const MAX_SUBMISSIONS_PER_HOUR = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Public endpoint (no login required, by design — anyone visiting the site can leave
// feedback). The only real defense against abuse is a light per-IP rate limit; worst
// case of it being open is a spammy GitHub issue, which is easy to close.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { title, body, submitter_name } = await req.json();
    if (typeof title !== "string" || !title.trim()) {
      return json({ error: "title is required" }, 400);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("feedback_requests")
      .select("id", { count: "exact", head: true })
      .eq("submitter_ip", ip)
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= MAX_SUBMISSIONS_PER_HOUR) {
      return json({ error: "rate_limited", detail: "Too many submissions recently — try again in a bit." }, 429);
    }

    const { data: row, error: insertError } = await supabase
      .from("feedback_requests")
      .insert({
        title: title.trim().slice(0, 300),
        body: (body || "").slice(0, 5000) || null,
        submitter_name: (submitter_name || "").trim().slice(0, 200) || null,
        submitter_ip: ip,
        status: "pending",
      })
      .select()
      .single();
    if (insertError || !row) {
      return json({ error: "failed_to_log_request", detail: insertError?.message }, 500);
    }

    const { data: secretRow } = await supabase
      .from("integration_secrets")
      .select("value")
      .eq("key", "github_issues_token")
      .maybeSingle();
    const githubToken = secretRow?.value;

    if (!githubToken) {
      await supabase
        .from("feedback_requests")
        .update({ status: "failed", error_message: "github_token_not_configured" })
        .eq("id", row.id);
      return json({ error: "github_token_not_configured", logged: true }, 500);
    }

    const issueBodyParts = [];
    if (row.submitter_name) issueBodyParts.push(`Submitted by: ${row.submitter_name}`);
    if (row.body) issueBodyParts.push(row.body);
    issueBodyParts.push("---\n_Submitted via the Erebe feedback form._");

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "erebe-feedback-form",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: row.title,
          body: issueBodyParts.join("\n\n"),
        }),
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      await supabase
        .from("feedback_requests")
        .update({ status: "failed", error_message: errText.slice(0, 500) })
        .eq("id", row.id);
      return json({ error: "github_issue_failed", detail: errText, logged: true }, 502);
    }

    const issue = await ghRes.json();
    await supabase
      .from("feedback_requests")
      .update({
        status: "created",
        github_issue_number: issue.number,
        github_issue_url: issue.html_url,
      })
      .eq("id", row.id);

    return json({ issue_number: issue.number, issue_url: issue.html_url });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
