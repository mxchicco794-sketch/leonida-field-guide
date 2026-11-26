import type { Group, Kind } from "./types";

/**
 * Etichette italiane dell'interfaccia per i gruppi e le categorie del catalogo Open GTA 6 Map.
 * Le chiavi restano quelle originali del dataset: non vengono modificati ID, coordinate o nomi propri.
 */
const GROUP_LABELS: Record<Group, string> = {
  Collectibles: "Collezionabili",
  Activities: "Attività",
  Crime: "Criminalità",
  Places: "Luoghi",
  Other: "Altro",
};

const KIND_LABELS: Record<string, string> = {
  flamingo: "Fenicotteri di cocaina",
  card: "Carte da collezione",
  waink: "Scansioni WAiNK",
  magazine: "Riviste, libri e fumetti",
  meditation: "Luoghi di meditazione",
  underwater: "Scoperte subacquee",
  kenton: "Serie di Kenton",
  playlist: "Playlist uniche",
  hoop: "Canestri da basket",
  bret: "Mazzi di bersagli di Bret",
  stunt: "Acrobazie e salti acrobatici",
  race: "Gare",
  drone: "Prove a tempo con i droni",
  range: "Poligoni di tiro",
  arcade: "Videogiochi, biliardo e minigolf",
  gang: "Attività delle gang",
  bank: "Banche e caveau",
  smash: "Furti lampo",
  store: "Negozi da rapinare",
  fence: "Ricettatori e Pay 'n' Spray",
  other: "Altro",
  package: "Pacchi nascosti",
  meteorite: "Meteoriti",
  treasure: "Tesori",
  bottle: "Messaggi in bottiglia",
  bookswap: "Scambi di libri",
  mural: "Murales 1010",
  streetart: "Street art di Ahol",
  vehicle: "Veicoli speciali",
  bridge: "Passaggi sotto i ponti",
  knife: "Voli radenti",
  basejump: "Salti BASE e paracadutismo",
  fishing: "Luoghi di pesca",
  hunting: "Caccia",
  event: "Eventi casuali",
  safe: "Casseforti",
  towatm: "Bancomat rimorchiabili",
  payday: "Prestiti a breve termine",
  weapon: "Armi da raccogliere",
  safehouse: "Rifugi",
  shop: "Negozi e servizi",
  food: "Ristoranti, bar e locali",
  hotel: "Hotel",
  transport: "Trasporti",
  civic: "Polizia, ospedali e uffici pubblici",
  leisure: "Tempo libero e sport",
  nature: "Elementi naturali",
  building: "Edifici e luoghi d'interesse",
};

export function groupLabel(group: Group): string {
  return GROUP_LABELS[group] ?? group;
}

export function kindLabel(kind: Pick<Kind, "key" | "name"> | undefined, fallback?: string): string {
  if (!kind) return fallback ?? "";
  return KIND_LABELS[kind.key] ?? kind.name;
}
