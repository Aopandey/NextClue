// Hand-written mirror of backend/app/contracts.py (patient.v1, analysis.v1, source.v1), field for field.
// Dates are ISO strings: `YYYY-MM-DD` for dates, ISO 8601 UTC for timestamps.
// Fields with a Pydantic default are required here, because the backend always serialises them.

// ---------------------------------------------------------------- 1. Patient input

export type Interpretation = "normal" | "abnormal" | "borderline" | "not_interpreted";

export interface Observation {
  name: string;
  value: string;
  unit: string | null;
  reference_range: string | null;
  interpretation: Interpretation;
}

export type DocumentType =
  | "clinic_note"
  | "lab_result"
  | "imaging"
  | "pathology"
  | "referral"
  | "genetic_report"
  | "other";

export interface PatientDocument {
  record_id: string;
  date: string;
  type: DocumentType;
  specialty: string;
  title: string;
  /** Role only, never a name. */
  author_role: string | null;
  text: string;
  observations: Observation[];
}

export interface Demographics {
  display_name: string;
  sex_at_birth: "female" | "male" | "intersex" | "unknown";
  birth_year: number;
}

export interface PatientRecord {
  schema_version: "patient.v1";
  patient_id: string;
  /** Bumped whenever any document changes. */
  record_version: number;
  synthetic: true;
  demographics: Demographics;
  documents: PatientDocument[];
}

// ---------------------------------------------------------------- 2. Analysis request (POST /analyses body)

export interface AnalysisRequest {
  patient_id: string;
  /** Omit for latest. */
  record_version?: number | null;
  excluded_record_ids?: string[];
  force_refresh?: boolean;
}

// ---------------------------------------------------------------- 3. Analysis output

export interface RecordRef {
  record_id: string;
  /** Exact quote from the document text. */
  excerpt: string;
}

export interface SourceRef {
  source_id: string;
  excerpt_id: string;
}

export type FindingKind =
  | "symptom"
  | "sign"
  | "lab_result"
  | "imaging"
  | "pathology"
  | "diagnosis"
  | "family_history";

export type Assertion = "present" | "absent" | "uncertain";

export interface Finding {
  finding_id: string;
  label: string;
  kind: FindingKind;
  assertion: Assertion;
  date: string | null;
  specialty: string | null;
  record_refs: RecordRef[];
  hpo_id: string | null;
}

export interface Claim {
  claim_id: string;
  text: string;
  record_refs: RecordRef[];
  source_refs: SourceRef[];
}

export interface PriorResultReview {
  prior_result_id: string;
  test_name: string;
  record_refs: RecordRef[];
  result_summary: string;
  interpretation_at_the_time: string;
  what_it_established: string;
  limitation_claim_ids: string[];
  hypothesis_ids: string[];
}

export type HypothesisStatus = "open" | "less_supported" | "excluded";

export interface Hypothesis {
  hypothesis_id: string;
  name: string;
  is_rare_disease: boolean;
  status: HypothesisStatus;
  summary: string;
  supporting_finding_ids: string[];
  supporting_claim_ids: string[];
  contradicting_claim_ids: string[];
}

export interface PossibleOutcome {
  outcome: string;
  implication: string;
}

export interface MissingEvidence {
  missing_id: string;
  /** 1 = investigate first. */
  priority: number;
  description: string;
  why_it_matters: string;
  check_existing_first: boolean;
  existing_record_refs: RecordRef[];
  claim_ids: string[];
  hypothesis_ids: string[];
  possible_outcomes: PossibleOutcome[];
}

export interface ClinicianQuestion {
  question_id: string;
  text: string;
  missing_ids: string[];
}

export interface AnalysisOutput {
  findings: Finding[];
  claims: Claim[];
  prior_results: PriorResultReview[];
  /** 1–3 items. */
  hypotheses: Hypothesis[];
  missing_evidence: MissingEvidence[];
  clinician_questions: ClinicianQuestion[];
}

// ---------------------------------------------------------------- 4. Analysis run envelope

export interface TimelineEvent {
  record_id: string;
  date: string;
  specialty: string;
  title: string;
  finding_ids: string[];
}

export type GraphNodeType = "finding" | "hypothesis" | "prior_result" | "missing_evidence";

export interface GraphNode {
  node_id: string;
  type: GraphNodeType;
  label: string;
}

export type EdgeRelation = "supports" | "previously_tested" | "would_clarify";

export interface GraphEdge {
  edge_id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
}

export interface ClueGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RunVersions {
  schema_version: string;
  model: string;
  prompt: string;
  evidence: string;
}

export type RunErrorCode =
  | "timeout"
  | "model_error"
  | "validation_failed"
  | "retrieval_failed"
  | "not_found"
  | "internal";

export interface RunError {
  code: RunErrorCode;
  message: string;
  retryable: boolean;
}

export type RunStatus = "queued" | "running" | "completed" | "failed";
export type Provenance = "live" | "replayed" | "fixture";

export interface AnalysisRun {
  schema_version: "analysis.v1";
  run_id: string;
  status: RunStatus;
  provenance: Provenance;
  replayed_from_run_id: string | null;
  fallback_reason: string | null;
  evidence_mode: "live" | "cached";
  patient_id: string;
  record_version: number;
  excluded_record_ids: string[];
  cache_key: string;
  versions: RunVersions;
  created_at: string;
  completed_at: string | null;
  error: RunError | null;
  output: AnalysisOutput | null;
  timeline: TimelineEvent[] | null;
  graph: ClueGraph | null;
  disclaimer: string;
}

// ---------------------------------------------------------------- 5. Medical evidence

export interface SourceExcerpt {
  excerpt_id: string;
  text: string;
  location: string | null;
}

export type SourceType = "genereviews" | "pubmed" | "guideline" | "hpo" | "other";

export interface Source {
  source_id: string;
  source_type: SourceType;
  title: string;
  publisher: string;
  year: number | null;
  /** Always https:// per the backend contract. */
  url: string;
  pmid: string | null;
  excerpts: SourceExcerpt[];
  verification_status: "verified" | "unverified";
  retrieved_on: string | null;
}

export interface SourceRegistry {
  schema_version: "source.v1";
  evidence_version: string;
  sources: Source[];
}
