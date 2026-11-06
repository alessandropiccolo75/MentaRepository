# Assegna

Applicazione per creare task, assegnarli e seguirne l'avanzamento. L'accesso delle persone è quello di Cursor (app privata o di team): Assegna non gestisce password. Ruoli, task, commenti, notifiche e storico stanno nel Postgres dell'app.

## Ruoli

- **Amministratore**: utenti, gruppi, tutti i task, configurazione.
- **Manager**: task del proprio gruppo, creazione e assegnazione.
- **Utente**: task assegnati, presa in carico, stato, avanzamento e commenti.

I controlli sono sul server. La prima persona reale che apre l'app diventa amministratore.

Anteprima e produzione usano gli stessi schemi ma righe separate (`stage`), così una preview non scrive sui dati di produzione.

## Avvio locale

```bash
npm install
npm run dev
```

In locale, senza `CURSOR_APP_ID`, l'app usa il profilo simulato in `cursor/identity.dev.js`. Non è un accesso reale.

`npm test` esegue i controlli su permessi e database in memoria.

## Email

L'invio è opzionale. Senza configurazione i messaggi restano in coda come non inviati.

- `RESEND_API_KEY` e `EMAIL_FROM` usano Resend.
- In alternativa `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `EMAIL_FROM`.
- Se sono presenti entrambi, vince Resend.

`DATABASE_URL` è impostato dalla piattaforma quando l'app ha il database Postgres. Non va messo nel repository.
