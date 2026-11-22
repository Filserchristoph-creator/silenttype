# SilentType

**Forschungs-Prototyp (Proof of Concept).** SilentType testet, ob sich **20 fest
vorgegebene deutsche Befehle allein an den Lippenbewegungen** unterscheiden
lassen — ganz ohne Ton. Es ist bewusst **keine fertige App**, sondern ein
ehrliches Experiment, um herauszufinden, ob die Idee technisch tragfähig ist.

> **Was es ehrlich NICHT tut:** Es liest keine beliebige deutsche Sprache. Es rät
> nicht einfach plausible Sätze. Es erkennt **nur**, was du ihm vorher
> antrainiert hast. Bei Unsicherheit sagt es „Unsicher" oder „Nicht erkannt".

---

## In 3 Minuten starten (MacBook)

Voraussetzung: einmalig Node.js installieren (ist auf diesem Rechner bereits via
Homebrew geschehen → `node -v` sollte eine Version zeigen).

```bash
cd silenttype
npm install
npm run dev
```

Dann die angezeigte Adresse öffnen (meist `http://localhost:5173`).
Auf `localhost` funktioniert die Kamera **ohne** HTTPS-Zertifikat.

**Erste Schritte in der App:**
1. Tab **Training** → „Kamera einschalten" (du wirst nach Kamera-Erlaubnis gefragt).
2. Den angezeigten Befehl **lautlos mit den Lippen formen** und „Aufnehmen" drücken.
   Mehrere Befehle, idealerweise 10× pro Befehl.
3. Zwischendurch einmal „Neue Sitzung" drücken und eine zweite Runde aufnehmen
   (wichtig für eine faire Auswertung).
4. Tab **Eingabe** → „Aufnehmen & Erkennen" → es vergleicht deine neue Aufnahme
   mit dem Gelernten.
5. Tab **Auswertung** → „Auswertung starten" → **echte** Trefferquoten.

---

## Nützliche Befehle

```bash
npm run dev          # Entwicklungsserver (http://localhost, Kamera ok)
npm run dev:https    # mit HTTPS (nötig für den iPhone-Test, s. u.)
npm run build        # Produktions-Build + TypeScript-Prüfung
npm test             # automatische Tests (DTW, Features, Pipeline)
npm run typecheck    # nur Typprüfung
npm run fetch-model  # Modell lokal speichern (optional, für Offline-Betrieb)
```

---

## Auf dem iPhone testen

Das iPhone darf die Kamera im Browser nur über **HTTPS** nutzen (localhost gilt
dort nicht). Deshalb gibt es einen HTTPS-Modus mit selbstsigniertem Zertifikat.

1. **Beide Geräte im selben WLAN** (MacBook und iPhone).
2. Auf dem MacBook:
   ```bash
   npm run dev:https
   ```
   Vite zeigt eine Adresse wie `https://192.168.x.x:5173` (die „Network"-Zeile).
3. Diese Adresse **auf dem iPhone in Safari** öffnen.
4. Safari warnt vor dem selbstsignierten Zertifikat → „Erweitert" →
   „Diese Website besuchen" (das ist hier sicher, es ist dein eigener Mac).
5. SilentType öffnet sich → „Kamera einschalten" → Safari fragt nach Erlaubnis →
   erlauben. Es wird automatisch die **Frontkamera** verwendet.
6. Hoch- und Querformat funktionieren; „Kopieren"/„Bestätigen" legt den Text in
   die Zwischenablage.

**Wenn das iPhone die Seite nicht lädt:**
- Firewall/VPN auf dem Mac kann die lokale Verbindung blockieren.
- Prüfe die IP-Adresse (System­einstellungen → WLAN → Details).
- Manche Gäste-WLANs trennen Geräte voneinander („Client Isolation") → anderes
  WLAN oder iPhone-Hotspot nutzen.

**Sicherheit:** Der Server ist nur im lokalen WLAN erreichbar. Gib die Adresse
**nicht** über einen öffentlichen Tunnel (ngrok o. ä.) frei — die Kamera soll
nicht unkontrolliert von außen erreichbar sein.

**PWA / Hintergrund:** Die Kamera läuft **nur**, solange SilentType im
Vordergrund ist. iOS stoppt die Kamera, sobald eine andere App (z. B. ChatGPT,
WhatsApp) in den Vordergrund kommt. Deshalb ist der Weg im PoC: hier erkennen →
Text **kopieren/teilen** → in der anderen App einfügen.

---

## Was ist schon drin? (Kurzüberblick)

| Baustein | Status |
|---|---|
| Minimalistische UI (Statusleiste, Modus-Button, iPhone-tauglich) | ✅ |
| Kamera-Zugriff (Front), nur nach Klick, Aktivität sichtbar | ✅ |
| Lippen-Landmarken via MediaPipe + Live-Overlay | ✅ |
| Live-Messwerte (FPS, Tracking-Qualität, verlorene Frames) | ✅ |
| Aufnahmeassistent für 20 Befehle, lokal gespeichert (IndexedDB) | ✅ |
| Export JSON/CSV, „alles löschen" | ✅ |
| Lernender Klassifikator (DTW + k-NN) mit Ablehnung bei Unsicherheit | ✅ |
| Ehrliche Auswertung (Leave-One-Session-Out, Confusion, Macro-F1, Baselines) | ✅ |
| Automatische Tests | ✅ (11 Tests grün) |
| Sprachmodus (Mikrofon) | ⛔ bewusst **nicht** implementiert |
| Reale Erkennungsgenauigkeit | ❓ **offen** — erst nach deinen Aufnahmen messbar |

Details: siehe **ARCHITECTURE.md**, **LIMITATIONS.md**, **EVALUATION.md**,
**RESEARCH.md**, **LICENSES.md**, **ROADMAP.md**.

---

## Datenschutz in einem Absatz

Kamera und Mikrofon sind standardmäßig **aus**. Die Kamera startet nur nach
deinem Klick, und ihre Aktivität ist oben in der Statusleiste sichtbar. Es
werden **ausschließlich Lippen-Messpunkte** gespeichert — **niemals ein Video**.
Alle Daten bleiben **lokal auf dem Gerät** (IndexedDB); es gibt **keine Uploads**
und **keine Telemetrie** im App-Code. Der einzige externe Abruf ist der einmalige
Download des Erkennungsmodells (Google-CDN) beim ersten Start — das kannst du mit
`npm run fetch-model` vermeiden. Siehe LIMITATIONS.md zum Thema DSGVO.
