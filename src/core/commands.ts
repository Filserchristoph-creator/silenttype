import type { Command } from "./types.ts";

/**
 * The exactly 20 German test commands for the Proof of Concept.
 * Order here is the canonical order; the recording assistant shuffles the
 * presentation order per session (see `recorder-view.ts`).
 *
 * IMPORTANT: none of these commands triggers a real system action in the PoC.
 * They are only labels the user silently mouths so we can test whether the
 * lip-movements are distinguishable at all.
 */
export const COMMANDS: Command[] = [
  { id: "neuer_absatz", label: "Neuer Absatz" },
  { id: "text_kopieren", label: "Text kopieren" },
  { id: "alles_markieren", label: "Alles markieren" },
  { id: "nachricht_senden", label: "Nachricht senden" },
  { id: "bitte_zusammenfassen", label: "Bitte zusammenfassen" },
  { id: "schreib_eine_email", label: "Schreib eine E-Mail" },
  { id: "mach_es_kuerzer", label: "Mach es kürzer" },
  { id: "erklaere_das_einfacher", label: "Erkläre das einfacher" },
  { id: "uebersetze_auf_englisch", label: "Übersetze auf Englisch" },
  { id: "erstelle_eine_liste", label: "Erstelle eine Liste" },
  { id: "oeffne_meinen_kalender", label: "Öffne meinen Kalender" },
  { id: "was_steht_heute_an", label: "Was steht heute an?" },
  { id: "suche_nach_informationen", label: "Suche nach Informationen" },
  { id: "lies_mir_das_vor", label: "Lies mir das vor" },
  { id: "formuliere_es_freundlicher", label: "Formuliere es freundlicher" },
  { id: "speichere_diesen_gedanken", label: "Speichere diesen Gedanken" },
  { id: "zeig_mir_meine_termine", label: "Zeig mir meine Termine" },
  { id: "fuege_einen_punkt_hinzu", label: "Füge einen Punkt hinzu" },
  { id: "beantworte_die_frage", label: "Beantworte die Frage" },
  { id: "ich_bin_fertig", label: "Ich bin fertig" },
];

export const COMMAND_IDS = COMMANDS.map((c) => c.id);

export function commandLabel(id: string): string {
  return COMMANDS.find((c) => c.id === id)?.label ?? id;
}

if (COMMANDS.length !== 20) {
  throw new Error(`Expected exactly 20 commands, got ${COMMANDS.length}`);
}
