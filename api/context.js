// "Trova con l'IA": cerca sul web esempi reali d'uso di un termine (un video
// YouTube, una o due citazioni) e restituisce anche quanto e costata la chiamata.
//
// Contro le citazioni inventate: si tengono solo i risultati il cui URL compare
// davvero tra quelli restituiti dalla ricerca web. Il resto viene scartato e
// contato in "dropped".
//
// POST { term, meaning_it, type } -> { items:[...], dropped, queries:[...], cost:{...} }
const DEFAULT_MODEL = "claude-haiku-5-5";
const MAX_SEARCHES = 3;
const SEARCH_USD = 0.01; // $10 ogni 1.000 ricerche

// Prezzi in dollari per milione di token. Haiku 5.5 ha due fasce secondo la lunghezza del prompt.
const PRICES = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, longIn: 0.5, longOut: 2.5, longAt: 100000 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-6": { in: 3, out: 15 },
};

const TYPE_LABEL = { word: "parola", phrasal_verb: "phrasal verb", idiom: "modo di dire", expression: "espressione" };

const SYSTEM_PROMPT = `Aiuti uno studente italiano a memorizzare un termine inglese mostrandogli dove viene usato DAVVERO. Usa la ricerca web (al massimo ${MAX_SEARCHES} ricerche) per trovare:
1. un video su YouTube in cui il termine si sente usato: scena di un film o di una serie, intervista, discorso, clip famosa;
2. una o due citazioni reali che contengono il termine: battuta di un film o di una serie, frase di una persona nota, passo di un libro, titolo o frase di un articolo.

Regole:
- Usa solo URL comparsi nei risultati delle tue ricerche. Non inventare mai URL, titoli o citazioni.
- La citazione deve contenere il termine (anche coniugato) e va riportata come appare nella fonte, al massimo 25 parole. Se dai risultati non riesci a leggere la frase esatta, lascia "quote" vuota.
- Preferisci esempi famosi e memorabili, in cui il significato si capisce dal contesto.
- Se per una categoria non trovi nulla di affidabile, omettila: meglio un solo risultato buono che tre deboli.

Alla fine rispondi SOLO con un oggetto JSON, senza testo prima o dopo e senza backtick: {"items":[{"kind":"video"|"quote","url":string,"title":string (titolo della pagina o del video),"quote":string,"source":string (chi la dice e in quale opera, breve),"why":string (in italiano, max 15 parole: cosa fa capire del termine)}]}`;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function priceFor(model) {
  const key = Object.keys(PRICES).find((k) => model === k || model.startsWith(k + "-"));
  return key ? PRICES[key] : null;
}

// Costo in dollari dei token di UNA richiesta (la fascia di prezzo dipende dalla sua lunghezza).
function tokenCost(usage, p) {
  const inTok = usage.input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const out = usage.output_tokens || 0;
  const long = p.longAt && inTok + cacheRead + cacheWrite > p.longAt;
  const pin = long ? p.longIn : p.in;
  const pout = long ? p.longOut : p.out;
  return (inTok * pin + cacheRead * pin * 0.1 + cacheWrite * pin * 1.25 + out * pout) / 1e6;
}

// Forma canonica di un URL, per confrontare quelli proposti con quelli trovati.
// Per YouTube conta solo l'id del video, qualunque sia la forma del link.
function canon(u) {
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^(www\.|m\.)/, "").toLowerCase();
    if (host === "youtu.be") return "yt:" + x.pathname.slice(1).split("/")[0];
    if (host.endsWith("youtube.com")) {
      const v = x.searchParams.get("v");
      if (v) return "yt:" + v;
      const m = x.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/);
      if (m) return "yt:" + m[2];
    }
    return host + x.pathname.replace(/\/+$/, "").toLowerCase();
  } catch (e) {
    return null;
  }
}

function extractJson(text) {
  const matches = [...text.matchAll(/\{\s*"items"\s*:/g)];
  if (!matches.length) return null;
  const start = matches[matches.length - 1].index;
  const end = text.lastIndexOf("}");
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({ error: "Metodo non consentito." }, 405);

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Corpo della richiesta non valido." }, 400);
    }
    const term = clip(body && body.term, 120);
    if (!term) return json({ error: "Manca il termine." }, 400);
    const meaning = clip(body.meaning_it, 300);
    const typeLabel = TYPE_LABEL[body.type] || "termine";

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY non configurata sul server (Vercel > Settings > Environment Variables)." }, 500);
    }
    const model = process.env.CONTEXT_MODEL || DEFAULT_MODEL;
    const price = priceFor(model);

    const messages = [
      {
        role: "user",
        content: `Termine: "${term}" (${typeLabel}).` + (meaning ? ` Significato: ${meaning}` : ""),
      },
    ];
    const blocks = [];
    const usage = { input_tokens: 0, output_tokens: 0, searches: 0, usd: 0 };

    const costOut = () => ({
      model,
      usd: price ? usage.usd + usage.searches * SEARCH_USD : null,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      searches: usage.searches,
    });

    // Il server di Anthropic puo mettere in pausa un turno lungo (pause_turn):
    // si rimanda indietro la risposta parziale e si continua, al massimo due volte.
    for (let round = 0; round < 3; round++) {
      let res, data;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1500,
            system: SYSTEM_PROMPT,
            tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
            messages,
          }),
        });
        data = await res.json();
      } catch (e) {
        return json({ error: "Chiamata ad Anthropic fallita: " + (e.message || e), cost: costOut() }, 502);
      }
      if (!res.ok) {
        const detail = (data && data.error && data.error.message) || "HTTP " + res.status;
        return json({ error: detail, cost: costOut() }, 502);
      }

      const u = data.usage || {};
      usage.input_tokens += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      usage.output_tokens += u.output_tokens || 0;
      usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      if (price) usage.usd += tokenCost(u, price);

      const content = Array.isArray(data.content) ? data.content : [];
      blocks.push(...content);
      if (data.stop_reason !== "pause_turn") break;
      if (messages.length === 1) messages.push({ role: "assistant", content });
      else messages[1] = { role: "assistant", content: [...messages[1].content, ...content] };
    }

    // URL davvero restituiti dalla ricerca (risultati e citazioni).
    const seen = new Set();
    const queries = [];
    for (const b of blocks) {
      if (b.type === "server_tool_use" && b.input && b.input.query) queries.push(b.input.query);
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r && r.url) seen.add(canon(r.url));
      }
      if (b.type === "text" && Array.isArray(b.citations)) {
        for (const c of b.citations) if (c && c.url) seen.add(canon(c.url));
      }
    }

    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = extractJson(text);
    if (!parsed || !Array.isArray(parsed.items)) {
      return json({ error: "Risposta dell'IA non interpretabile.", queries, cost: costOut() }, 502);
    }

    let dropped = 0;
    const items = [];
    for (const it of parsed.items) {
      const url = clip(it && it.url, 500);
      const key = url && canon(url);
      if (!key || !seen.has(key)) {
        dropped++;
        continue;
      }
      items.push({
        kind: it.kind === "video" || key.startsWith("yt:") ? "video" : "quote",
        url,
        title: clip(it.title, 200),
        quote: clip(it.quote, 300),
        source: clip(it.source, 160),
        why: clip(it.why, 160),
      });
      if (items.length >= 3) break;
    }

    return json({ items, dropped, queries, cost: costOut() }, 200);
  },
};
