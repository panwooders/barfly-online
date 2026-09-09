// Cancello password davanti a TUTTO il sito (pagina + /api), incluse le
// chiamate che toccano la chiave Anthropic e il database: senza password
// corretta non si passa. Nessun account utente: una sola password condivisa,
// impostata come variabile d'ambiente APP_PASSWORD su Vercel.
//
// Gira su ogni richiesta (nessun "matcher" = protegge tutto il progetto,
// vedi https://vercel.com/docs/routing-middleware).
import { next } from "@vercel/functions";

export default function middleware(request) {
  const expected = process.env.APP_PASSWORD;
  const authHeader = request.headers.get("authorization");

  if (expected && authHeader && authHeader.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(authHeader.slice(6));
    } catch (e) {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    const pass = sep === -1 ? decoded : decoded.slice(sep + 1);
    if (pass === expected) {
      return next();
    }
  }

  return new Response("Autenticazione richiesta.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="The Barfly\'s Bible"' },
  });
}
