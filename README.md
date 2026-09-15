# DVS Utility

Web app/PWA indipendente per gli strumenti interni di Digital Video Service, coordinata graficamente con DVS Planning e DVS Gestionale.

## Versione 3.4

- dashboard principale a riquadri in stile DVS liquid glass;
- colori coordinati per ogni riquadro: verde Audio, blu Video, ciano Loudness, arancione Scheda Tecnica e viola Calcolatrice;
- navigazione desktop e mobile coordinata;
- logo Digital Video originale;
- icona Utility con bagliore verde;
- icona coordinata Utility originale applicata a favicon, iPhone e manifest PWA, con formati derivati dal master PNG 1024 px;
- modulo DCP Audio invariato nella logica e ottimizzato per Mac, iPhone e iPad.
- titolo del DCP modificabile;
- tabella finale senza la colonna tecnica delle tracce;
- storico DCP condiviso tramite Supabase, senza archiviare l'EDL;
- salvataggio esplicito oppure automatico quando si genera il PDF;
- riapertura, modifica, aggiornamento, eliminazione e nuovo PDF dei DCP salvati.
- home compatta senza scorrimento su desktop;
- accesso immediato a Carica EDL e Storico DCP;
- moduli attivi presenti anche nella navigazione laterale;
- schermata Informazioni coordinata al DVS Planning.
- Calcolatrice Timecode con 24, 25, 30 e 60 fps, operazioni concatenate, DA–A e cronologia;
- DCP Video con selezione tracce, elenco alfabetico, ricerca e selezione delle righe;
- nel DCP Video schermata e PDF dichiarano soltanto i nomi delle clip, senza indicarne la durata;
- il PDF Video include soltanto le righe selezionate, mentre lo storico conserva l'elenco completo;
- storico unico con distinzione tra rapporti Audio e Video.
- cronologia Timecode immediata: il primo operando e l'operatore compaiono prima del risultato;
- piste DCP Video selezionabili e deselezionabili singolarmente, con conteggio visibile;
- Scheda Tecnica RAI con compilazione moderna, 15 servizi e PDF A4;
- Scheda Tecnica con esito Trasmettibile/Non trasmettibile, TC finale e durata automatica a 25 fps;
- PDF tecnico su una sola pagina A4, con omissione automatica delle righe servizio vuote;
- storico Supabase delle Schede Tecniche con riapertura, modifica, eliminazione e PDF automatico;
- menu Servizio con Anteprima, Programma, Orologio, Barre colore, Neri commerciali, Nero, Intro, Coda finale e Coda finale + fondini;
- Loudness locale per WAV PCM/Float mono e multicanale fino a 8 canali;
- controllo RAI di Program Loudness, Maximum True Peak e LRA;
- waveform reale con avanzamento, normalizzazione manuale e verifica automatica del nuovo WAV;
- esportazione WAV normalizzato a 24 bit / 48 kHz senza invio del file a servizi esterni.

## Moduli

- **DCP Audio**: disponibile.
- **DCP Video**: disponibile.
- **Loudness**: disponibile.
- **Scheda Tecnica**: disponibile.
- **Calcolatrice Timecode**: disponibile.

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

## Loudness

Il WAV viene elaborato soltanto nel browser e non viene caricato su Supabase. L'analisi verifica il target RAI `-23 LUFS ± 0,2`, il Maximum True Peak `-2 dBTP` e il limite LRA di `20 LU`. La normalizzazione parte solo dopo la scelta esplicita dell'utente; il file creato viene rianalizzato automaticamente prima del download.

L'esportazione standard è WAV PCM a 24 bit / 48 kHz. I WAV RIFF oltre 4 GB richiedono RF64 e vengono segnalati prima dell'esportazione.

## Scheda Tecnica

La schermata di compilazione genera tramite il comando **PDF** il modello RAI in formato A4. La finestra di sistema consente di salvarlo direttamente come PDF.

## Database storico

Per una nuova installazione, eseguire nel SQL Editor del progetto Supabase dedicato a DVS Utility:

`database/001_dcp_audio_history.sql`

Se la versione Audio era già installata, eseguire una sola volta:

`database/002_dcp_video_history.sql`

Per abilitare lo storico delle Schede Tecniche, eseguire una sola volta:

`database/003_technical_sheets_history.sql`

## Avvio locale

```bash
npm start
```

Aprire `http://localhost:4173`.

## Pubblicazione GitHub Pages

Il progetto è statico e non richiede build. È sufficiente pubblicare la radice del repository tramite GitHub Pages.
