// Screenshot dei contesti ("Visto dal vivo"), salvati su Supabase Storage.
// Come per i dati, la Service Role Key resta qui sul server: il browser parla
// solo con questa funzione, che sta dietro la stessa password del sito
// (middleware.js). Il bucket e privato e viene creato da solo al primo upload.
//
// POST   (corpo: l'immagine, Content-Type image/jpeg|png|webp) -> { path }
// GET    ?p=<path>  -> l'immagine
// DELETE ?p=<path>  -> { ok: true }
const BUCKET = "barfly-media";
const PATH_RE = /^ctx\/[A-Za-z0-9-]{8,64}\.(jpg|png|webp)$/;
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 4 * 1024 * 1024; // sotto il limite di 4,5 MB del corpo delle funzioni Vercel

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function ensureBucket(base, auth) {
  const res = await fetch(base + "/bucket", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: false,
      file_size_limit: 5 * 1024 * 1024,
      allowed_mime_types: Object.keys(TYPES),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (!/already exists|duplicate/i.test(text)) throw new Error("creazione del bucket non riuscita: " + text);
  }
}

export default {
  async fetch(request) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Supabase non configurato sul server (Vercel > Settings > Environment Variables)." }, 500);
    }
    const base = SUPABASE_URL.replace(/\/$/, "") + "/storage/v1";
    const auth = { apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY };
    const url = new URL(request.url);

    try {
      if (request.method === "GET" || request.method === "DELETE") {
        const p = url.searchParams.get("p") || "";
        if (!PATH_RE.test(p)) return json({ error: "Percorso non valido." }, 400);

        if (request.method === "GET") {
          const res = await fetch(base + "/object/" + BUCKET + "/" + p, { headers: auth });
          if (!res.ok) return json({ error: "Immagine non trovata." }, 404);
          return new Response(res.body, {
            status: 200,
            headers: {
              "Content-Type": res.headers.get("content-type") || "image/jpeg",
              // Ogni file ha un nome unico e non cambia mai: il browser lo tiene in cache.
              "Cache-Control": "private, max-age=31536000, immutable",
            },
          });
        }

        const res = await fetch(base + "/object/" + BUCKET, {
          method: "DELETE",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ prefixes: [p] }),
        });
        if (!res.ok) return json({ error: "Supabase: " + (await res.text()) }, 502);
        return json({ ok: true }, 200);
      }

      if (request.method === "POST") {
        const type = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        const ext = TYPES[type];
        if (!ext) return json({ error: "Formato immagine non supportato." }, 415);
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return json({ error: "Immagine vuota." }, 400);
        if (buf.byteLength > MAX_BYTES) return json({ error: "Immagine troppo grande." }, 413);

        const path = "ctx/" + crypto.randomUUID() + "." + ext;
        const put = () =>
          fetch(base + "/object/" + BUCKET + "/" + path, {
            method: "POST",
            headers: { ...auth, "Content-Type": type, "x-upsert": "false", "cache-control": "31536000" },
            body: buf,
          });

        let res = await put();
        if (!res.ok) {
          const text = await res.text();
          if (!/bucket not found/i.test(text)) return json({ error: "Supabase: " + text }, 502);
          await ensureBucket(base, auth);
          res = await put();
          if (!res.ok) return json({ error: "Supabase: " + (await res.text()) }, 502);
        }
        return json({ path }, 200);
      }
    } catch (e) {
      return json({ error: "Impossibile contattare Supabase: " + (e.message || e) }, 502);
    }

    return json({ error: "Metodo non consentito." }, 405);
  },
};
