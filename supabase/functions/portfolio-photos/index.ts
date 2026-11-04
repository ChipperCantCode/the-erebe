import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Admin-only photo storage for the portfolio (portfolio.html inline editor).
//
// The site has no Supabase Auth, so Storage policies can't tell an admin from anyone
// else. Instead the browser sends its admin session token; this function checks it
// against admin_sessions (not expired) and only then touches Storage/the database with
// the service role. The browser has already resized each image into a "full" (~2000px)
// and a "display" (~1200px) JPEG before sending.
//
// Request: multipart/form-data with `action` and `token`, plus:
//   upload          project_id, full, display, width, height, fit?, caption?
//   replace         photo_id, full, display, width, height, fit?
//   delete_photo    photo_id
//   delete_project  project_id   (the DB trigger snapshots the piece into the audit table first)

const BUCKET = "portfolio";
const MAX_BYTES = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FITS = new Set(["normal", "enlarge", "pad"]);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function str(form: FormData, key: string) {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function imageFile(form: FormData, key: string): File | null {
  const v = form.get(key);
  if (!(v instanceof File)) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(v.type)) return null;
  if (v.size === 0 || v.size > MAX_BYTES) return null;
  return v;
}

function intOrNull(v: string) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const form = await req.formData();
    const action = str(form, "action");
    const token = str(form, "token");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (!UUID_RE.test(token)) return json({ error: "invalid_admin_session" }, 401);
    const { data: session } = await supabase
      .from("admin_sessions")
      .select("token")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!session) return json({ error: "invalid_admin_session" }, 401);

    const storage = supabase.storage.from(BUCKET);

    async function putPair(projectId: string, full: File, display: File) {
      const base = `projects/${projectId}/${crypto.randomUUID()}`;
      const fullPath = `${base}-full.jpg`;
      const displayPath = `${base}-display.jpg`;
      const opts = { contentType: "image/jpeg", cacheControl: "31536000", upsert: false };
      const a = await storage.upload(fullPath, full, { ...opts, contentType: full.type });
      if (a.error) throw new Error("storage_upload_failed: " + a.error.message);
      const b = await storage.upload(displayPath, display, { ...opts, contentType: display.type });
      if (b.error) {
        await storage.remove([fullPath]);
        throw new Error("storage_upload_failed: " + b.error.message);
      }
      return { fullPath, displayPath };
    }

    if (action === "upload" || action === "replace") {
      const full = imageFile(form, "full");
      const display = imageFile(form, "display");
      if (!full || !display) return json({ error: "bad_image", detail: "Images only (JPEG/PNG/WebP), up to 10 MB." }, 400);
      const width = intOrNull(str(form, "width"));
      const height = intOrNull(str(form, "height"));
      const fitRaw = str(form, "fit");
      const fit = FITS.has(fitRaw) ? fitRaw : "normal";

      if (action === "upload") {
        const projectId = str(form, "project_id");
        if (!UUID_RE.test(projectId)) return json({ error: "project_not_found" }, 404);
        const { data: project } = await supabase.from("portfolio_projects").select("id").eq("id", projectId).maybeSingle();
        if (!project) return json({ error: "project_not_found" }, 404);

        const { data: last } = await supabase
          .from("portfolio_photos")
          .select("sort_order")
          .eq("project_id", projectId)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { fullPath, displayPath } = await putPair(projectId, full, display);
        const { data: row, error } = await supabase
          .from("portfolio_photos")
          .insert({
            project_id: projectId,
            storage_path: fullPath,
            display_path: displayPath,
            width,
            height,
            fit,
            caption: str(form, "caption").slice(0, 1000) || null,
            sort_order: (last?.sort_order ?? 0) + 10,
          })
          .select()
          .single();
        if (error) {
          await storage.remove([fullPath, displayPath]);
          return json({ error: "db_insert_failed", detail: error.message }, 500);
        }
        return json({ photo: row });
      }

      // replace: new files under new names (so browsers/CDN never show the stale image),
      // then point the row at them, then remove the old files.
      const photoId = str(form, "photo_id");
      if (!UUID_RE.test(photoId)) return json({ error: "photo_not_found" }, 404);
      const { data: old } = await supabase.from("portfolio_photos").select("*").eq("id", photoId).maybeSingle();
      if (!old) return json({ error: "photo_not_found" }, 404);
      const { fullPath, displayPath } = await putPair(old.project_id, full, display);
      const { data: row, error } = await supabase
        .from("portfolio_photos")
        .update({ storage_path: fullPath, display_path: displayPath, width, height, fit })
        .eq("id", photoId)
        .select()
        .single();
      if (error) {
        await storage.remove([fullPath, displayPath]);
        return json({ error: "db_update_failed", detail: error.message }, 500);
      }
      await storage.remove([old.storage_path, old.display_path].filter(Boolean));
      return json({ photo: row });
    }

    if (action === "delete_photo") {
      const photoId = str(form, "photo_id");
      if (!UUID_RE.test(photoId)) return json({ error: "photo_not_found" }, 404);
      const { data: old } = await supabase.from("portfolio_photos").select("*").eq("id", photoId).maybeSingle();
      if (!old) return json({ ok: true }); // already gone
      const { error } = await supabase.from("portfolio_photos").delete().eq("id", photoId);
      if (error) return json({ error: "db_delete_failed", detail: error.message }, 500);
      await storage.remove([old.storage_path, old.display_path].filter(Boolean));
      return json({ ok: true });
    }

    if (action === "delete_project") {
      const projectId = str(form, "project_id");
      if (!UUID_RE.test(projectId)) return json({ error: "project_not_found" }, 404);
      const { data: photos } = await supabase
        .from("portfolio_photos")
        .select("storage_path, display_path")
        .eq("project_id", projectId);
      const { error } = await supabase.from("portfolio_projects").delete().eq("id", projectId);
      if (error) return json({ error: "db_delete_failed", detail: error.message }, 500);
      const paths = (photos || []).flatMap((p) => [p.storage_path, p.display_path]).filter(Boolean);
      if (paths.length) await storage.remove(paths);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    return json({ error: "server_error", detail: String(err) }, 500);
  }
});
