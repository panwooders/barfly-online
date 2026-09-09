# The Barfly's Bible — versione online

Stessa app, stesso design di adesso. Cambia solo dove vivono le cose:

- la pagina (`index.html`) resta identica a quella che usi in locale, tolta la
  gestione della chiave API lato browser;
- `api/generate.js` genera le schede: chiama Anthropic **dal server**, con la
  chiave letta da una variabile d'ambiente (mai nel browser);
- `api/vocab.js` legge/scrive i tuoi termini e temi su Supabase, sempre dal
  server (stesso motivo: la chiave che parla con Supabase non deve mai finire
  nel codice che gira nel tuo browser);
- `middleware.js` mette una password davanti a tutto il sito, pagina e `api/`
  comprese: senza password corretta non si vede né si tocca niente.

Non serve nessun editor di codice per fare il deploy: solo creare due account
gratuiti, incollare uno script SQL una volta, e collegare GitHub a Vercel.

## Passo 1 — Due account gratuiti

Entrambi gratis, nessuna carta di credito richiesta:

1. **Vercel** — [vercel.com/signup](https://vercel.com/signup), scegli "Continue
   with GitHub" (usa l'account GitHub che hai già). Il piano **Hobby** è
   gratuito per sempre per uso personale, e non serve un dominio: ogni
   progetto ha già un indirizzo tipo `barfly-tuonome.vercel.app`, funzionante
   per sempre — un dominio tuo è facoltativo e puoi anche non aggiungerlo mai.
2. **Supabase** — [supabase.com/dashboard](https://supabase.com/dashboard/sign-up).
   Il piano **Free** dà 500 MB di spazio (per un vocabolario personale è
   moltissimo) e non chiede carta.
   ⚠️ Unica particolarità da sapere: **un progetto gratuito si mette in pausa
   dopo una settimana senza attività**. Non è grave e non perdi dati — se apri
   l'app dopo una pausa lunga e non vedi i tuoi termini, vai sul dashboard
   Supabase e clicca "Restore project" (un clic, riparte in circa un minuto).

## Passo 2 — Supabase: crea il progetto e la tabella

1. Nel dashboard Supabase, **New project** (nome libero, es. "barfly"), scegli
   una regione vicina (es. Europe/Frankfurt) e una password del database
   qualsiasi (non ti servirà più, Supabase la usa internamente).
2. Quando il progetto è pronto, apri **SQL Editor → New query**, incolla tutto
   il contenuto di [`supabase/schema.sql`](./supabase/schema.sql) di questa
   cartella e premi **Run**. Crea la tabella che tiene i tuoi termini e temi.
3. Vai su **Project Settings → Data API**. Ti serviranno due valori tra poco:
   - **Project URL** (tipo `https://xxxxxxxx.supabase.co`)
   - **service_role key** (in "Project API keys" — è quella segreta, **non**
     la "anon/public"; non va mai messa nel codice o su GitHub, solo nelle
     variabili d'ambiente di Vercel al Passo 5)

## Passo 3 — GitHub: crea il repository

1. Su GitHub, **New repository** (es. `barfly-online`), privato è meglio
   (comunque non contiene mai chiavi o password, quelle stanno solo su
   Vercel, ma non serve renderlo pubblico).
2. Carica dentro **tutti i file di questa cartella** (`index.html`,
   `middleware.js`, `package.json`, `package-lock.json`, `.gitignore`,
   `api/`, `supabase/`) mantenendo la stessa struttura — via web (drag & drop
   dei file/cartelle nella pagina del repo) o da terminale con `git`.

## Passo 4 — Vercel: importa il repository

1. Nel dashboard Vercel, **Add New → Project**, scegli il repository appena
   creato.
2. Framework: lascia **"Other"** (non è un progetto Next.js/React con build,
   è già pronto così). Non serve toccare build command o output directory.
3. **Non premere ancora Deploy** — prima le variabili d'ambiente (Passo 5),
   altrimenti il primo deploy parte senza le chiavi e fallisce alla prima
   richiesta.

## Passo 5 — Variabili d'ambiente

Nella schermata di import del progetto (o dopo, in **Settings → Environment
Variables**), aggiungi queste quattro:

| Nome | Valore | Dove prenderlo |
|---|---|---|
| `ANTHROPIC_API_KEY` | la tua chiave `sk-ant-…` | quella che usi già nel file locale |
| `SUPABASE_URL` | il Project URL di Supabase | Passo 2.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role key di Supabase | Passo 2.3 |
| `APP_PASSWORD` | una password a scelta tua | inventala ora, sarà quella che il browser ti chiederà per entrare nell'app |

Poi **Deploy**.

## Passo 6 — Primo accesso

Apri l'indirizzo `.vercel.app` che Vercel ti dà a fine deploy. Il browser
chiede utente e password (schermata nativa, non una pagina dell'app): utente
puoi lasciarlo vuoto o scrivere quello che vuoi, la password è quella che hai
messo in `APP_PASSWORD`. Da lì in poi l'app è quella che conosci.

La prima volta la Collezione sarà vuota — è normale, Supabase parte senza
dati.

## Passo 7 — Porta dentro la tua collezione attuale

Nel file locale sul Mac (`The Barfly's Bible.html`), premi **Esporta**: scarica
un JSON con tutti i tuoi termini e temi. Poi apri la versione online, vai su
**Aggiungi → gestisci** no — più semplice: il pulsante **Importa** è visibile
in alto in qualunque sezione, esattamente come nel file locale. Selezioni
quel JSON e i tuoi termini/temi vengono caricati nel database online (i
duplicati per nome vengono riconosciuti e saltati, come già fa oggi).

Da quel momento la versione online è la tua copia sincronizzata: cellulare e
desktop leggono e scrivono sullo stesso database Supabase.

## Aggiornare l'app in futuro

Ogni volta che vuoi cambiare qualcosa: modifichi i file nel repository GitHub
(anche solo `index.html`), fai push — Vercel rifà il deploy da solo in
automatico in circa un minuto, niente da fare a mano.

## Il file locale sul Mac resta separato

`The Barfly's Bible.html` sul tuo Mac continua a funzionare come ora, per
uso offline: legge/scrive nel suo `localStorage` e usa la sua chiave API
locale, indipendente da tutto questo. Le due versioni non si sincronizzano
tra loro in automatico — il ponte tra le due è l'Esporta/Importa JSON.

## Sicurezza, in breve

- La chiave Anthropic e quella di Supabase (`service_role`) non sono mai nel
  codice né nel browser: vivono solo come variabili d'ambiente su Vercel e
  vengono lette dalle funzioni server (`api/generate.js`, `api/vocab.js`).
- `middleware.js` protegge con password **tutto** il progetto, incluse quelle
  funzioni: senza password, nessuno può far generare schede con la tua chiave
  né leggere/scrivere i tuoi dati.
- Su Supabase la tabella ha la Row Level Security attiva e senza policy: chi
  avesse in mano solo l'indirizzo del progetto Supabase non potrebbe comunque
  leggere né scrivere nulla senza la service_role key, che non esce mai da
  Vercel.
