// Lettura/scrittura dei dati (termini + temi) su Supabase, lato server.
// La Service Role Key (SUPABASE_SERVICE_ROLE_KEY) vive solo qui come
// variabile d'ambiente su Vercel: bypassa la Row Level Security e non viene
// MAI spedita al browser. Il client parla solo con questa funzione, mai
// direttamente con Supabase.
//
// GET  -> { entries: [...], topics: [...] }
// PUT  { key: "entries" | "topics", value: [...] } -> { ok: true }
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Supabase non configurato sul server (Vercel > Settings > Environment Variables)." }, 500);
    }
    const base = SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/vocab_kv";
    const headers = {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
    };

    if (request.method === "GET") {
      let res;
      try {
        res = await fetch(base + "?select=key,value", { headers });
      } catch (e) {
        return json({ error: "Impossibile contattare Supabase: " + e.message }, 502);
      }
      if (!res.ok) {
        return json({ error: "Supabase: " + (await res.text()) }, 502);
      }
      const rows = await res.json();
      const out = { entries: [], topics: [] };
      for (const row of rows) {
        if (row.key === "entries" || row.key === "topics") out[row.key] = row.value;
      }
      return json(out, 200);
    }

    if (request.method === "PUT") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Corpo della richiesta non valido." }, 400);
      }
      if (body.key !== "entries" && body.key !== "topics") {
        return json({ error: "Chiave non valida." }, 400);
      }
      if (!Array.isArray(body.value)) {
        return json({ error: "Il valore deve essere un array." }, 400);
      }
      let res;
      try {
        res = await fetch(base + "?on_conflict=key", {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify([
            { key: body.key, value: body.value, updated_at: new Date().toISOString() },
          ]),
        });
      } catch (e) {
        return json({ error: "Impossibile contattare Supabase: " + e.message }, 502);
      }
      if (!res.ok) {
        return json({ error: "Supabase: " + (await res.text()) }, 502);
      }
      return json({ ok: true }, 200);
    }

    return json({ error: "Metodo non consentito." }, 405);
  },
};
