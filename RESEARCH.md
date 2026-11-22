# RESEARCH.md — Bestehende Modelle & Projekte

> Stand: 2026-11-22. Dieser Bericht trennt **bestätigte Fakten** von **offenen
> Fragen**. „Offen" heißt: muss vor einer kommerziellen Nutzung noch geprüft
> werden (oft von einem Menschen / einer Rechtsberatung). Es wurden **keine
> großen Modelle heruntergeladen**; die Lizenz-/Rechteklärung steht teils aus.

## Zusammenfassung in einem Satz

Für den sofort nutzbaren PoC verwenden wir **MediaPipe Face Landmarker**
(reine Lippen-/Gesichtspunkt-Erfassung, kommerziell nutzbar). Die großen
Lippenlese-Forschungsmodelle sind wissenschaftlich stark, aber für ein
lautloses, deutsches, iPhone-taugliches Produkt **nicht out-of-the-box**
geeignet und haben teils einschränkende Lizenzen.

---

## 1) MediaPipe Face Landmarker — die Basis unseres PoC

- **Was:** Erkennt 478 Gesichtspunkte inkl. Lippenkontur, läuft im Browser
  (WASM/WebGL) und nativ.
- **Lippenlesen?** Nein — es liest keine Wörter. Es liefert nur die
  Messpunkte. Die Worterkennung bauen *wir* darauf auf. Genau das wollen wir.
- **Lautlose Sprache geeignet?** Ja, als Merkmalsquelle: es braucht keinen Ton.
- **Deutsch?** Sprachunabhängig (es sind nur Geometriepunkte).
- **Apple-Silicon-Mac?** Ja (läuft im Browser, nutzt GPU).
- **iPhone?** Ja, läuft in Safari (WebGL/WASM).
- **Rechenleistung:** Gering, echtzeitfähig auf Handys.
- **Lizenz Code:** Apache-2.0 (kommerziell nutzbar). ✅ *bestätigt für die Bibliothek*
- **Lizenz Modellgewichte:** Von Google bereitgestellt; **Nutzungsbedingungen
  für das konkrete Modell-Asset noch final zu prüfen** (offen).
- **Kommerziell nutzbar?** Code ja; für die Modellgewichte die Google-Terms
  final prüfen (offen).

**Fazit:** Beste Wahl für den PoC. Risiko gering, aber Modell-Asset-Terms
vor Produktstart verbindlich klären.

---

## 2) Auto-AVSR (github.com/mpc001/auto_avsr)

- **Was:** Audio-Visual Speech Recognition (Forschung), state-of-the-art
  Lippenlesen auf Benchmarks wie LRS3.
- **Lippenlesen?** Ja, sehr gut — aber trainiert auf **lautem, gesprochenem**
  Englisch mit großen Videodatensätzen.
- **Lautlose Sprache?** **Offen/kritisch:** lautlos geformte Wörter sehen
  anders aus als hörbar gesprochene. Ein auf hörbarer Sprache trainiertes
  Modell passt nicht automatisch.
- **Deutsch?** Nein (Englisch/LRS3). Deutsch wäre Neu-Training nötig.
- **Apple-Silicon / iPhone?** Nein, nicht ohne Weiteres — PyTorch-Modell,
  rechenintensiv, nicht für Safari/iPhone gedacht.
- **Rechenleistung:** Hoch (GPU-Training, schwere Inferenz).
- **Lizenz Code:** **Offen — im Repo nachsehen; teils nicht-kommerziell.**
- **Lizenz Modellgewichte / Trainingsdaten (LRS3 etc.):** **Oft
  Forschungs-/Non-Commercial-Lizenz** → für ein Produkt kritisch. (offen)
- **Kommerziell?** **Vermutlich eingeschränkt** — unbedingt prüfen. (offen)

**Fazit:** Wissenschaftliche Referenz, aber kein Produktbaustein für uns.

---

## 3) Lipflow (github.com/amywork777/lipflow)

- **Was:** Kleineres Community-/Hobby-Projekt rund um Lippen-Eingabe.
- **Reifegrad / Eignung / Deutsch / iPhone / Lizenzen:** **Alles offen** —
  muss vor Nutzung konkret im Repo geprüft werden (Reife, Tests, Lizenz).
- **Fazit:** Als Ideen-/Code-Referenz interessant, nicht als Abhängigkeit
  einplanen, bis Lizenz und Qualität bestätigt sind. (offen)

## 4) Hushkey (github.com/amirrsyed/hushkey)

- **Was:** Projekt im Umfeld „lautlose/stille Eingabe".
- **Alle 10 Prüfpunkte:** **Offen** — Repo-Stand, Ansatz (Kamera vs. andere
  Sensorik), Deutsch, Plattform, Lizenz noch zu prüfen.
- **Fazit:** Beobachten; nichts übernehmen ohne Lizenz-/Qualitätsprüfung.

## 5) MuAViC (github.com/facebookresearch/muavic)

- **Was:** Mehrsprachiger audiovisueller Datensatz (Meta) für AVSR,
  inkl. mehrerer Sprachen.
- **Lippenlesen?** Datensatz, kein fertiges Modell.
- **Deutsch?** **Offen** — Sprachabdeckung konkret prüfen.
- **Lautlos?** Nein — abgeleitet aus gesprochenem Material (TED/Video).
- **Lizenz Daten:** **Meist CC BY-NC / Forschung → nicht kommerziell.** (offen,
  aber Tendenz: eingeschränkt)
- **Fazit:** Nützlich für Forschung/Vergleich, Daten vermutlich nicht
  kommerziell verwertbar.

---

## Gesamtbewertung für SilentType

| Projekt | Für PoC nutzbar | Lautlos | Deutsch | iPhone | Kommerziell |
|---|---|---|---|---|---|
| MediaPipe Face Landmarker | **Ja** | ja | ja | ja | Code ✅ / Asset offen |
| Auto-AVSR | nein | kritisch | nein | nein | wahrsch. nein (offen) |
| Lipflow | offen | offen | offen | offen | offen |
| Hushkey | offen | offen | offen | offen | offen |
| MuAViC | nur Forschung | nein | offen | – | wahrsch. nein |

**Kernerkenntnis:** Es gibt (Stand heute, nach dieser Recherche) **kein frei
und kommerziell nutzbares Modell, das lautlos geformtes Deutsch zuverlässig
und auf dem iPhone liest.** Deshalb ist unser Weg richtig: erst mit einem
kleinen, kontrollierten Befehlswortschatz testen, ob die Aufgabe überhaupt
lösbar ist — mit eigenen, sauber lizenzierbaren Daten.

> Hinweis zur Ehrlichkeit: Mehrere Lizenzangaben oben sind **„offen"**, weil sie
> ohne Aufruf der jeweiligen Repos/Terms nicht verbindlich bestätigt werden
> können. Vor jeder produktiven Nutzung eines dieser Projekte muss die Lizenz
> im Original geprüft werden (siehe LICENSES.md).
