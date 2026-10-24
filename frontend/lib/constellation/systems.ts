import type { Finding } from "@/lib/contracts";

export type BodySystem =
  | "nerve"
  | "sweat"
  | "gut"
  | "kidney"
  | "eye"
  | "family"
  | "blood"
  | "heart"
  | "lung"
  | "joint"
  | "other";

export const SYSTEM_ORDER: BodySystem[] = [
  "nerve",
  "sweat",
  "gut",
  "kidney",
  "eye",
  "family",
  "blood",
  "heart",
  "lung",
  "joint",
  "other",
];

export const SYSTEM_LABEL: Record<BodySystem, string> = {
  nerve: "Nerves",
  sweat: "Skin",
  gut: "Gut",
  kidney: "Kidney",
  eye: "Eye",
  family: "Family",
  blood: "Blood",
  heart: "Heart",
  lung: "Lungs",
  joint: "Joints",
  other: "Other",
};

// Maps, not object literals, so IDs like "constructor" never hit Object.prototype.
const BY_ID = new Map<string, BodySystem>([
  ["fnd-limb-pain", "nerve"],
  ["fnd-small-fiber-neuropathy", "nerve"],
  ["fnd-reduced-sweating", "sweat"],
  ["fnd-gi-symptoms", "gut"],
  ["fnd-celiac-negative", "gut"],
  ["fnd-proteinuria", "kidney"],
  ["fnd-father-dialysis", "family"],
  ["fnd-cornea-verticillata", "eye"],
  ["fnd-enzyme-normal", "blood"],
  ["fnd-diabetes-absent", "blood"],
]);

/** Label keywords, checked in this order; the first match wins. */
const BY_KEYWORD: [BodySystem, RegExp][] = [
  ["nerve", /neuropath|nerve|burning|numb|tingl|limb pain/i],
  ["sweat", /sweat|hidro|skin|rash|angiokeratoma/i],
  ["gut", /abdominal|diarrh|bowel|gut|celiac|nausea/i],
  ["kidney", /protein|kidney|renal|uacr|creatinine|dialysis/i],
  ["eye", /cornea|eye|vision|retina/i],
  ["heart", /heart|cardi|palpitation|arrhythm/i],
  ["lung", /lung|breath|pulmon/i],
  ["joint", /joint|arthr/i],
  ["blood", /enzyme|hba1c|blood|anemia|vitamin|lab/i],
];

const BY_SPECIALTY = new Map<string, BodySystem>([
  ["neurology", "nerve"],
  ["dermatology", "sweat"],
  ["gastroenterology", "gut"],
  ["nephrology", "kidney"],
  ["ophthalmology", "eye"],
  ["cardiology", "heart"],
  ["pulmonology", "lung"],
  ["rheumatology", "joint"],
]);

/** Body system for a finding: known ID, family history, label keywords, specialty, else "other". */
export function systemFor(f: Finding): BodySystem {
  const byId = BY_ID.get(f.finding_id);
  if (byId) return byId;
  if (f.kind === "family_history") return "family";
  return systemForText(f.label ?? "", f.specialty);
}

/** Body system from a label's keywords, then a specialty, else "other" (also used for prior tests). */
export function systemForText(label: string, specialty: string | null | undefined): BodySystem {
  const byKeyword = BY_KEYWORD.find(([, pattern]) => pattern.test(label));
  if (byKeyword) return byKeyword[0];
  const bySpecialty = specialty ? BY_SPECIALTY.get(specialty.trim().toLowerCase()) : undefined;
  return bySpecialty ?? "other";
}
