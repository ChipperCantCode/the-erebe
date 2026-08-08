import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GITHUB_REPO_OWNER = "chippercantcode";
const GITHUB_REPO_NAME = "the-erebe";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { session_token, title, body } = await req.json();
    if (!session_token || typeof title !== "string" || !title.trim()) {
      return json({ error: "session_token and title are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // mirrors check_admin_session() in Postgres, done here in JS since this function
    // runs with the service role key (bypasses RLS) rather than as a DB function
    const { data: session } = await supabase
      .from("admin_sessions")
      .select("token")
      .eq("token", session_token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!session) {
      return json({ error: "invalid_admin_session" }, 401);
    }

    const { data: secretRow } = await supabase
      .from("integration_secrets")
      .select("value")
      .eq("key", "github_issues_token")
      .maybeSingle();
    const githubToken = secretRow?.value;

    const { data: row, error: insertError } = await supabase
      .from("feedback_requests")
      .insert({ title: title.trim(), body: body || null, status: "pending" })
      .select()
      .single();
    if (insertError || !row) {
      return json({ error: "failed_to_log_request", detail: insertError?.message }, 500);
    }

    if (!githubToken) {
      await supabase
        .from("feedback_requests")
        .update({ status: "failed", error_message: "github_token_not_configured" })
        .eq("id", row.id);
      return json({ error: "github_token_not_configured", logged: true }, 500);
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "erebe-admin-feedback",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          body: (body || "") + "\n\n---\n_Submitted via the Erebe admin console._",
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
