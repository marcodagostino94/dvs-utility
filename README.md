# DVS Utility

Web app/PWA indipendente per gli strumenti interni di Digital Video Service.

## Moduli

- **DCP Audio**: disponibile.
- **DCP Video**: predisposto per una versione successiva.

## Funzionamento DCP Audio

1. In Avid Media Composer aprire **Tools → List Tool**.
2. Caricare la sequenza e includere tutte le tracce audio e video.
3. Usare `File_129`, ordinamento `A (Record In)`, handles a `0`.
4. In **Both Picture and Sound** includere Clip Names e Source File Name.
5. In **Sound** attivare Dissolves.
6. Salvare la lista come `.edl` e trascinarla nella Utility.
7. Selezionare le sole tracce musicali e generare il rapporto.

Il file è analizzato localmente nel browser e non viene inviato a un server.

## Avvio locale

```bash
npm start
```

Aprire `http://localhost:4173`.

## Pubblicazione GitHub Pages

Il progetto è statico e non richiede build. È sufficiente pubblicare la radice del repository tramite GitHub Pages.
