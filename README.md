# DVS Utility

Web app/PWA indipendente per gli strumenti interni di Digital Video Service, coordinata graficamente con DVS Planning e DVS Gestionale.

## Versione 1.2

- dashboard principale a riquadri in stile DVS liquid glass;
- navigazione desktop e mobile coordinata;
- logo Digital Video originale;
- icona Utility con bagliore verde;
- modulo DCP Audio invariato nella logica e ottimizzato per Mac, iPhone e iPad.
- titolo del DCP modificabile;
- tabella finale senza la colonna tecnica delle tracce;
- storico DCP condiviso tramite Supabase, senza archiviare l'EDL;
- salvataggio esplicito oppure automatico quando si genera il PDF;
- riapertura, modifica, aggiornamento, eliminazione e nuovo PDF dei DCP salvati.

## Moduli

- **DCP Audio**: disponibile.
- **DCP Video**: predisposto per una versione successiva.
- **Loudness**: predisposto per una versione successiva.
- **Scheda Tecnica**: predisposto per una versione successiva.
- **Calcolatrice Timecode**: predisposta per una versione successiva.

## Funzionamento DCP Audio

1. In Avid Media Composer aprire **Tools → List Tool**.
2. Caricare la sequenza e includere tutte le tracce audio e video.
3. Usare `File_129`, ordinamento `A (Record In)`, handles a `0`.
4. In **Both Picture and Sound** includere Clip Names e Source File Name.
5. In **Sound** attivare Dissolves.
6. Salvare la lista come `.edl` e trascinarla nella Utility.
7. Selezionare le sole tracce musicali e generare il rapporto.

Il file è analizzato localmente nel browser e non viene inviato a un server.
Nel database viene salvato esclusivamente il rapporto DCP elaborato.

## Database storico

Prima di usare lo storico, eseguire nel SQL Editor dello stesso progetto Supabase usato da Planning e Gestionale:

`database/001_dcp_audio_history.sql`

## Avvio locale

```bash
npm start
```

Aprire `http://localhost:4173`.

## Pubblicazione GitHub Pages

Il progetto è statico e non richiede build. È sufficiente pubblicare la radice del repository tramite GitHub Pages.
