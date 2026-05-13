# ADDED · Discovery

Internt verktyg för uppstartsmöten — Next.js (App Router) med JSON-lagring per kund på disk.

## Snabbstart

```bash
npm install
npm run dev
```

Sedan: <http://localhost:3000>

## Bygg + produktionsstart

```bash
npm run build
npm start
```

## Datalagring

Varje kund sparas som en JSON-fil i `./data/`, namngiven efter en slug av kundens namn (t.ex. `acme-ab.json`). Filen skrivs atomiskt (tmp + rename) vid varje autosave (~600 ms efter senaste ändring).

Om du byter namn på kunden i formuläret döps filen om till den nya sluggen vid nästa save.

### Format

```json
{
  "client": "Acme AB",
  "date": "2026-05-13",
  "activeSection": 1,
  "answers": { "1-0": "...", "1-3": ["Anna — VD"] },
  "updatedAt": "2026-05-13T12:34:56.789Z"
}
```

## API

| Metod  | Endpoint                  | Beskrivning                             |
| ------ | ------------------------- | --------------------------------------- |
| GET    | `/api/customers`          | Lista alla kunder (sorterat på senast). |
| POST   | `/api/customers`          | Skapa ny kund från `{ client, ... }`.   |
| GET    | `/api/customers/:slug`    | Hämta en kund.                          |
| PUT    | `/api/customers/:slug`    | Uppdatera (kan döpa om vid namnbyte).   |
| DELETE | `/api/customers/:slug`    | Ta bort kund.                           |

## Filstruktur

```
app/
  api/customers/route.ts          # list + create
  api/customers/[slug]/route.ts   # read / update / delete
  globals.css                     # samma tema som tidigare
  layout.tsx
  page.tsx                        # hela klientvyn
lib/
  sections.ts                     # frågor + typer
  storage.ts                      # JSON-IO + slug-säkerhet
data/                             # kunder lagras här
legacy/
  ADDED · Discovery.html          # gamla single-file-versionen
```

## Anteckningar

- Autosave är debouncad till 600 ms. Indikatorn i headern visar `Sparar` → `Sparat`.
- Att skapa en helt ny kund kräver att fältet `Kund` har ett namn — annars sparas inget.
- Säkerhetskontroll på slug-nivå förhindrar path traversal (endast `[a-z0-9-]+`).
