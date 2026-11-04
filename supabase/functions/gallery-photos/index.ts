import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Community gallery uploads (gallery.html). Deliberately public -- anyone can add a photo
// to any section, no login needed -- so the server side enforces what the form asks for:
//   * a photographer credit (or "I took it") and a rights/consent confirmation
//   * images only, 10 MB max per file, and a per-IP rate limit
// The browser has already resized each image into "full" (~2000px) and "display"
// (~1200px) JPEGs. Re-encoding through a canvas also strips EXIF metadata, including
// GPS location, which is the main privacy risk with phone photos.
//
// If the uploader sends a donor (My List) session token, the photo is tied to their
// account so they can edit its caption or remove it later. Anonymous uploads can only
// be changed by an admin.
//
// Request: multipart/form-data with `action`:
//   upload          section_id, full, display, width, height, fit?, caption?, uploader_name?,
//                   is_own_photo ("true"/"false"), photographer (required unless is_own_photo),
//                   rights_confirmed ("true"), donor_token?
//   delete_photo    photo_id, and donor_token (owner) or admin_token
//   delete_section  section_id, admin_token   (only if the section is empty)

const BUCKET = "gallery";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_UPLOADS_PER_HOUR = 20;
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
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const storage = supabase.storage.from(BUCKET);
    const nowIso = new Date().toISOString();

    async function donorFor(token: string): Promise<string | null> {
      if (!UUID_RE.test(token)) return null;
      const { data } = await supabase
        .from("donor_sessions")
        .select("donor_id")
        .eq("token", token)
        .gt("expires_at", nowIso)
        .maybeSingle();
      return data?.donor_id ?? null;
    }
    async function isAdmin(token: string): Promise<boolean> {
      if (!UUID_RE.test(token)) return false;
      const { data } = await supabase
        .from("admin_sessions")
        .select("token")
        .eq("token", token)
        .gt("expires_at", nowIso)
        .maybeSingle();
      return !!data;
    }

    if (action === "upload") {
      const sectionId = str(form, "section_id");
      if (!UUID_RE.test(sectionId)) return json({ error: "section_not_found" }, 404);
      const { data: section } = await supabase.from("gallery_sections").select("id").eq("id", sectionId).maybeSingle();
      if (!section) return json({ error: "section_not_found" }, 404);

      if (str(form, "rights_confirmed") !== "true") return json({ error: "rights_not_confirmed" }, 400);
      const isOwn = str(form, "is_own_photo") === "true";
      const uploaderName = str(form, "uploader_name").slice(0, 100) || null;
      let photographer = str(form, "photographer").slice(0, 100);
      if (isOwn) photographer = uploaderName || "the uploader";
      if (!photographer) return json({ error: "photographer_required" }, 400);

      const full = imageFile(form, "full");
      const display = imageFile(form, "display");
      if (!full || !display) return json({ error: "bad_image", detail: "Images only (JPEG/PNG/WebP), up to 10 MB." }, 400);

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("gallery_photos")
        .select("id", { count: "exact", head: true })
        .eq("uploader_ip", ip)
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= MAX_UPLOADS_PER_HOUR) {
        return json({ error: "rate_limited", detail: "That's a lot of photos in one go -- try again in an hour." }, 429);
      }

      const donorId = await donorFor(str(form, "donor_token"));
      const fitRaw = str(form, "fit");

      const base = `sections/${sectionId}/${crypto.randomUUID()}`;
      const fullPath = `${base}-full.jpg`;
      const displayPath = `${base}-display.jpg`;
      const opts = { cacheControl: "3600" /* 1-hour cache: a deleted/taken-down photo stops loading from the CDN within the hour */, upsert: false };
      const a = await storage.upload(fullPath, full, { ...opts, contentType: full.type });
      if (a.error) return json({ error: "storage_upload_failed", detail: a.error.message }, 500);
      const b = await storage.upload(displayPath, display, { ...opts, contentType: display.type });
      if (b.error) {
        await storage.remove([fullPath]);
        return json({ error: "storage_upload_failed", detail: b.error.message }, 500);
      }

      const { data: last } = await supabase
        .from("gallery_photos")
        .select("sort_order")
        .eq("section_id", sectionId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: row, error } = await supabase
        .from("gallery_photos")
        .insert({
          section_id: sectionId,
          storage_path: fullPath,
          display_path: displayPath,
          width: intOrNull(str(form, "width")),
          height: intOrNull(str(form, "height")),
          fit: FITS.has(fitRaw) ? fitRaw : "normal",
          caption: str(form, "caption").slice(0, 500) || null,
          photographer,
          is_own_photo: isOwn,
          uploader_name: uploaderName,
          donor_id: donorId,
          uploader_ip: ip,
          sort_order: (last?.sort_order ?? 0) + 10,
        })
        .select("id")
        .single();
      if (error) {
        await storage.remove([fullPath, displayPath]);
        return json({ error: "db_insert_failed", detail: error.message }, 500);
      }
      return json({ id: row.id, linked_to_account: !!donorId });
    }

    if (action === "delete_photo") {
      const photoId = str(form, "photo_id");
      if (!UUID_RE.test(photoId)) return json({ error: "photo_not_found" }, 404);
      const { data: photo } = await supabase.from("gallery_photos").select("*").eq("id", photoId).maybeSingle();
      if (!photo) return json({ ok: true });

      const admin = await isAdmin(str(form, "admin_token"));
      const donorId = admin ? null : await donorFor(str(form, "donor_token"));
      if (!admin && (!donorId || donorId !== photo.donor_id)) return json({ error: "not_your_photo" }, 403);

      const { error } = await supabase.from("gallery_photos").delete().eq("id", photoId);
      if (error) return json({ error: "db_delete_failed", detail: error.message }, 500);
      await storage.remove([photo.storage_path, photo.display_path].filter(Boolean));
      return json({ ok: true });
    }

    if (action === "delete_section") {
      if (!(await isAdmin(str(form, "admin_token")))) return json({ error: "invalid_admin_session" }, 401);
      const sectionId = str(form, "section_id");
      if (!UUID_RE.test(sectionId)) return json({ error: "section_not_found" }, 404);
      const { count } = await supabase
        .from("gallery_photos")
        .select("id", { count: "exact", head: true })
        .eq("section_id", sectionId);
      if ((count ?? 0) > 0) return json({ error: "section_not_empty" }, 409);
      const { error } = await supabase.from("gallery_sections").delete().eq("id", sectionId);
      if (error) return json({ error: "db_delete_failed", detail: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (err) {
    return json({ error: "server_error", detail: String(err) }, 500);
  }
});
