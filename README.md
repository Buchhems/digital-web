# Digital Web

Ein Simulator für digitale Schaltungen im Browser, optimiert für das iPad im Unterricht.
Er ist angelehnt an [Digital](https://github.com/hneemann/Digital) von Helmut Neemann und
liest und schreibt dessen `.dig`-Dateien.

## Funktionen

- **Touch-Bedienung:** Bauteile antippen oder auf die Fläche ziehen. Leitungen zieht man vom Anschlusspunkt aus. Verschoben wird mit einem Finger, gezoomt mit zwei. Der Apple Pencil funktioniert ebenfalls.
- **Schaltzeichen nach DIN EN 60617** (&, ≥1, =1, 1 mit Negationskreis). Die amerikanischen IEEE-Symbole lassen sich optional einschalten.
- **Bauteile:** Ein-/Ausgänge (auch mehrbittig), LED, Taster, Takt, Konstante, Masse/Versorgung, Messwert, 7-Segment-Anzeigen, UND/ODER/NICHT/NAND/NOR/XOR/XNOR (2–16 Eingänge, Eingänge negierbar), Tunnel, Splitter, Multiplexer, Demultiplexer, Decoder, RS-, JK-, D- und T-Flipflop, Addierer, Komparator, Zähler, Register, Text
- **Simulation** mit Farbcodierung der Leitungen (hellgrün = 1, dunkelgrün = 0, blau = offen, rot = Fehler). Sie erkennt Kurzschlüsse, falsche Bitbreiten und schwingende Schaltungen.
- **Wahrheitstabelle** per Knopfdruck mit **Zwischenschritten**: Beschriftete Gatter (z. B. „Z1“) erscheinen als eigene Spalten, wahlweise auch alle Gatter. Dazu kommen die **disjunktive Minimalform (DMF)** mit Negation als Überstrich und **KV-Diagramme** mit farbig markierten Primimplikanten.
- **Wahrheitstabelle eingeben** (auch mit X = don't care) → DMF, KV-Diagramm und Schaltung. **Übungsmodus:** Ausgänge einer Schaltung selbst ausfüllen und prüfen lassen.
- **Schaltwerke:** Zustandsanalyse von Schaltungen mit D-, JK-, T- und RS-Flipflops (Zustandsübergangstabelle, Ansteuerung, Zustandsdiagramm, Gleichungen) sowie ein **Automaten-Editor** (Moore), der aus dem Zustandsdiagramm eine Schaltung mit D-Flipflops erzeugt.
- **Schaltungssynthese:** Schaltung aus der DMF oder aus einer eingegebenen Formel erzeugen (z. B. `Y = ¬(A ∧ B) ∨ C`).
- **Eigene Bausteine (Teilschaltungen):** Ein Projekt kann mehrere Schaltungen enthalten, und jede lässt sich in den anderen als Baustein einsetzen. Die Anschlüsse sind die beschrifteten Ein- und Ausgänge, wie in Digital.
- **Messgraph:** Zeitdiagramm aller Ein- und Ausgänge während der Simulation. Die Taktfrequenz ist auch während der Simulation einstellbar.
- **Testfälle** im Format von Digital (Bauteil „Testfall“). Ergebnis mit Markierung falscher Zeilen.
- **Dateien:** Automatische Sicherung im Browser. Export als `.dig` (bei Bausteinen mehrere Dateien bzw. ZIP) oder PNG. Import von `.dig`- und `.zip`-Dateien, auch mehrere gleichzeitig.
- **Offline-fähig (PWA):** In Safari über *Teilen → Zum Home-Bildschirm* wie eine App installierbar

## Veröffentlichen mit GitHub Pages

1. Neues Repository auf GitHub anlegen, z. B. `digital-web`.
2. Den Inhalt dieses Ordners hochladen. Im Browser geht das über *Add file → Upload files*, alternativ per Git:
   ```bash
   git remote add origin https://github.com/BENUTZERNAME/digital-web.git
   git push -u origin main
   ```
3. Im Repository unter **Settings → Pages** bei *Source* „Deploy from a branch“ wählen, dann Branch `main` und Ordner `/ (root)` → **Save**.
4. Nach ca. einer Minute ist die App unter `https://BENUTZERNAME.github.io/digital-web/` erreichbar.

Es gibt keinen Build-Schritt: reines HTML, CSS und JavaScript (ES-Module).

## Lokal testen

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

(Ein Webserver ist nötig, weil Browser ES-Module nicht direkt von `file://` laden.)

## Projektstruktur

| Datei | Inhalt |
|---|---|
| `js/components.js` | Bauteil-Bibliothek: Geometrie, Symbole, Logik |
| `js/circuit.js` | Datenmodell, Netzbildung, Aufräumen von Leitungen |
| `js/sim.js` | Ereignisgesteuerter Simulator |
| `js/editor.js` | Zeichenfläche und Touch-Bedienung |
| `js/dig.js` | Import und Export des `.dig`-Formats |
| `js/analysis.js` | Wahrheitstabelle, Zwischenschritte, Minimierung (Quine-McCluskey) |
| `js/kv.js` | KV-Diagramme |
| `js/synth.js` | Formel-Parser, Darstellung, Schaltungsaufbau |
| `js/graph.js` | Messgraph |
| `js/testcase.js` | Testfälle |
| `js/lib.js` | Projekt-Bibliothek für Bausteine |
| `js/zip.js` | ZIP lesen/schreiben |
| `js/seq.js` | Schaltwerke: Zustandsanalyse, Zustandsdiagramm, Automaten-Synthese |
| `js/fsmeditor.js` | Automaten-Editor |
| `js/app.js` | Oberfläche, Dialoge, Speichern |
| `js/examples.js` | Beispielschaltungen |

## Kompatibilität mit Digital

Positionen, Raster (20), Anschlusspunkte und Drehung entsprechen dem Desktop-Programm.
Nicht unterstützte Bauteile aus `.dig`-Dateien werden als Platzhalter angezeigt und beim
Speichern unverändert zurückgeschrieben.

## Lizenz

GPL-3.0, wie das Original-Projekt *Digital*, aus dem Geometrie und Dateiformat übernommen sind.
