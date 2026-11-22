# LIMITATIONS.md — Bekannte Einschränkungen (ehrlich)

## Das zentrale offene Problem

**Ob lautlos geformte Lippenbewegungen überhaupt zuverlässig unterscheidbar
sind, ist noch nicht bewiesen.** Genau das soll dieser PoC herausfinden. Viele
Laute sehen auf den Lippen gleich aus (z. B. **B / P / M** — Lippen schließen
identisch). Lautlos geformte Wörter unterscheiden sich zusätzlich von hörbar
gesprochenen. Deshalb starten wir mit nur **20 Befehlen** statt freier Sprache.

## Was dieser PoC NICHT kann / NICHT behauptet

- **Keine freie deutsche Spracherkennung.** Nur die 20 trainierten Befehle.
- **Keine Erkennung ohne Training.** Ohne deine Aufnahmen erkennt das System
  nichts — es gibt keine vorgefertigte „Intelligenz" für Lippen.
- **Keine erfundenen Ergebnisse.** Es sind keine Trefferquoten hinterlegt. Zahlen
  entstehen erst aus echten Tests (Tab „Auswertung").
- **Kein heimliches Mikrofon.** Im lautlosen Modus wird das Mikrofon nie
  geöffnet. Der Sprachmodus ist gar nicht implementiert.
- **Keine Systemaktionen.** Die Befehle lösen nichts aus (kein Senden, kein
  Löschen, keine Fremd-App-Steuerung).

## Technische Einschränkungen

- **„Konfidenz" ist nicht kalibriert.** Der angezeigte Prozentwert kommt aus dem
  Abstand zwischen bestem und zweitbestem Treffer. Es ist **keine echte
  Wahrscheinlichkeit**. Eine Kalibrierung (z. B. gegen reale Trefferquoten) steht
  aus.
- **Ablehnungsschwelle unkalibriert.** `rejectDistance` ist anfangs „unendlich"
  (lehnt nie wegen Distanz ab). Erst mit echten Daten lässt sich eine sinnvolle
  Schwelle setzen (siehe EVALUATION.md).
- **Feste Aufnahmedauer (3 s).** Es gibt noch keine automatische Erkennung von
  Äußerungs-Beginn/-Ende. Man drückt bewusst einen Knopf.
- **Beleuchtung/Kopfhaltung.** Starke Seitenansicht, schlechtes Licht oder
  Verdeckung (Hand, Bart, Maske) senken die Tracking-Qualität.
- **Mehrere Gesichter.** Es wird nur **ein** Gesicht verarbeitet (numFaces=1);
  andere Personen im Bild werden ignoriert — gut für Datenschutz, aber bei
  mehreren Gesichtern evtl. das „falsche".
- **k-NN skaliert linear.** Bei sehr vielen Aufnahmen wird die Erkennung
  langsamer.
- **Browser-Hintergrund/iOS.** Die Kamera läuft nur im Vordergrund; iOS stoppt
  sie beim App-Wechsel. Eine systemweite Hintergrund-Eingabe ist mit einer
  Web-App **nicht** möglich (siehe unten).

## Plattform-Realität (wichtig für die Vision)

Die langfristige Idee „lautlos in ChatGPT/WhatsApp tippen, während die andere
App offen ist" ist mit einer **Web-App technisch nicht** umsetzbar: iOS/macOS
erlauben keiner Webseite, die Kamera zu nutzen, während eine andere App vorne
ist. Realistisch ist im PoC: **in SilentType erkennen → Text kopieren/teilen →
woanders einfügen.** Eine echte Systemintegration bräuchte native Apps und
spezielle Berechtigungen (iOS-Keyboard-Extensions dürfen z. B. standardmäßig
**nicht** auf die Kamera zugreifen). Das ist separat zu prüfen (ROADMAP.md).

## Datenschutz / DSGVO — kein Freifahrtschein

Lippen-/Gesichtsdaten können **biometrische Daten** (Art. 9 DSGVO) sein. Wir
minimieren bewusst (nur Messpunkte, kein Video, lokal, keine Identifikation).
**Das macht das Produkt aber nicht automatisch DSGVO-konform.** Vor einem Einsatz
mit mehreren Personen oder im Unternehmen sind nötig: Einwilligungen,
Verarbeitungsverzeichnis, ggf. Datenschutz-Folgenabschätzung, Prüfung durch
fachkundige Beratung. **Diese rechtliche Prüfung ist noch offen.**

## Reproduzierbarkeit

- Die automatischen Tests nutzen **synthetische** Daten und beweisen nur, dass
  die Pipeline *lernt* und die Metriken korrekt rechnen — **nicht**, wie gut
  echtes Lippenlesen funktioniert.
- Shuffle im Aufnahmeassistenten ist zufällig (nicht seed-fixiert).
