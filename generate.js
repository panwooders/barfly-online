// Proxy server-side verso l'API Anthropic: la chiave (ANTHROPIC_API_KEY) vive
// solo qui, come variabile d'ambiente su Vercel, e non viene mai spedita al
// browser. Riceve { term }, restituisce la scheda già pronta (stesso schema
// che prima costruiva il client leggendo la risposta di Anthropic).
const SYSTEM_PROMPT = `Sei un tutor d'inglese conciso per uno studente italiano. Analizzi un termine inglese (parola, phrasal verb, idioma o espressione) e restituisci SOLO un oggetto JSON, senza testo prima o dopo, senza backtick. Schema: {"term":string (forma normalizzata/base), "type":"word"|"phrasal_verb"|"idiom"|"expression", "meaning_it":string (spiegazione chiara in italiano, 1 frase), "examples":[string,string] (2 frasi d'esempio in inglese, naturali), "register":string (es. informale/formale/neutro, breve, in italiano), "tip":string (una nota utile in italiano: sfumatura, errore comune o sinonimo), "distractors_it":[string,string,string] (3 significati in italiano PLAUSIBILI MA SBAGLIATI per questo termine, vicini per tema o registro cosi da essere insidiosi in un quiz, ma chiaramente NON corretti e mai sinonimi del significato giusto), "distractors_en":[string,string,string] (3 termini/espressioni inglesi PLAUSIBILI MA SBAGLIATI, simili per forma o suono o significato al termine giusto, tipiche confusioni, mai sinonimi corretti), "is_verb":boolean (true SOLO se il termine e un verbo o una locuzione verbale per cui l'infinito "to <termine>" ha senso; false per sostantivi, aggettivi, avverbi ed espressioni non verbali), "input_lang":"en"|"it" (lingua della stringa ricevuta)}.

ECCEZIONE — se la stringa ricevuta e in italiano E ha da 2 a 4 rese inglesi davvero diverse per registro o per situazione d'uso, NON restituire la scheda: restituisci SOLO {"input_lang":"it","candidates":[{"term":string (la resa inglese, forma base), "register":string (breve, in italiano), "when":string (in quale situazione si usa quella resa, max 8 parole, in italiano)}]}, ordinate dalla piu comune alla piu rara. Rese che sono semplici sinonimi intercambiabili NON vanno separate: in quel caso, e ogni volta che la stringa italiana ha una sola resa naturale, restituisci direttamente la scheda completa del termine inglese corrispondente, senza "candidates".`;

const DEFAULT_MODEL = "claude-haiku-4-5";

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Metodo non consentito." }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Corpo della richiesta non valido." }, 400);
    }

    const term = ((body && body.term) || "").trim();
    if (!term) {
      return json({ error: "Manca il termine da analizzare." }, 400);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return json({ error: "ANTHROPIC_API_KEY non configurata sul server (Vercel > Settings > Environment Variables)." }, 500);
    }

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: term }],
        }),
      });
    } catch (e) {
      return json({ error: "Chiamata ad Anthropic fallita: " + e.message }, 502);
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      return json({ error: "Risposta di Anthropic non leggibile." }, 502);
    }

    if (!res.ok) {
      const detail = (data && data.error && data.error.message) || "HTTP " + res.status;
      return json({ error: detail }, 502);
    }

    const raw = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const clean = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

    let entry;
    try {
      entry = JSON.parse(clean);
    } catch (e) {
      return json({ error: "Risposta dell'IA non interpretabile come JSON." }, 502);
    }

    return json(entry, 200);
  },
};
