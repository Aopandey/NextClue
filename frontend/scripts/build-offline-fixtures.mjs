// Builds the offline bundle in frontend/fixtures/ from backend/data/, without a running backend.
//
// It reproduces, field for field, what the backend would serve:
//   - GET /fixtures/analyses/{id}  -> backend/app/main.py:get_fixture_analysis
//     (envelope, timeline per views.build_timeline, graph per views.build_graph,
//      cache_key per validation.compute_cache_key, reference checks per find_reference_errors)
//   - GET /patients/{id}           -> PatientRecord (documents ordered by date, record_id, as db.get_patient)
//   - GET /sources/{id}            -> Source, for every source the run's claims cite
// Objects are emitted as Pydantic's model_dump(mode="json") would: field order of backend/app/contracts.py,
// every defaulted field present, unknown keys rejected (extra="forbid").
//
// Run from frontend/:  node scripts/build-offline-fixtures.mjs [patient_id]   (default sarah-001)

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "..", "backend", "data");
const OUT_DIR = join(HERE, "..", "fixtures");

// backend/app/contracts.py
const ANALYSIS_SCHEMA_VERSION = "analysis.v1";
const DISCLAIMER =
  "Clinical decision support prototype using synthetic data. Not clinically " +
  "validated.";
// backend/app/main.py: dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc), serialised by Pydantic.
const FIXTURE_TIMESTAMP = "2026-10-24T00:00:00Z";

// ---------------------------------------------------------------- models (contracts.py)

const req = (child) => ({ required: true, child });
const opt = (fallback, child) => ({ required: false, fallback, child });
const list = (child) => (items, where) => items.map((item, i) => child(item, `${where}[${i}]`));

function model(name, fields) {
  return (raw, where = name) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`${where}: expected a ${name} object`);
    }
    const unknown = Object.keys(raw).filter((key) => !(key in fields));
    if (unknown.length) throw new Error(`${where}: unknown keys ${unknown.join(", ")}`);
    const out = {};
    for (const [key, spec] of Object.entries(fields)) {
      if (!(key in raw)) {
        if (spec.required) throw new Error(`${where}: missing required ${key}`);
        out[key] = structuredClone(spec.fallback);
        continue;
      }
      const value = raw[key];
      out[key] = spec.child && value !== null ? spec.child(value, `${where}.${key}`) : value;
    }
    return out;
  };
}

const Observation = model("Observation", {
  name: req(), value: req(), unit: opt(null), reference_range: opt(null), interpretation: req(),
});
const PatientDocument = model("PatientDocument", {
  record_id: req(), date: req(), type: req(), specialty: req(), title: req(),
  author_role: opt(null), text: req(), observations: opt([], list(Observation)),
});
const Demographics = model("Demographics", { display_name: req(), sex_at_birth: req(), birth_year: req() });
const PatientRecord = model("PatientRecord", {
  schema_version: opt("patient.v1"), patient_id: req(), record_version: req(), synthetic: opt(true),
  demographics: req(Demographics), documents: req(list(PatientDocument)),
});

const RecordRef = model("RecordRef", { record_id: req(), excerpt: req() });
const SourceRef = model("SourceRef", { source_id: req(), excerpt_id: req() });
const Finding = model("Finding", {
  finding_id: req(), label: req(), kind: req(), assertion: req(), date: opt(null), specialty: opt(null),
  record_refs: req(list(RecordRef)), hpo_id: opt(null),
});
const Claim = model("Claim", {
  claim_id: req(), text: req(), record_refs: req(list(RecordRef)), source_refs: req(list(SourceRef)),
});
const PriorResultReview = model("PriorResultReview", {
  prior_result_id: req(), test_name: req(), record_refs: req(list(RecordRef)), result_summary: req(),
  interpretation_at_the_time: req(), what_it_established: req(), limitation_claim_ids: req(), hypothesis_ids: opt([]),
});
const Hypothesis = model("Hypothesis", {
  hypothesis_id: req(), name: req(), is_rare_disease: req(), status: req(), summary: req(),
  supporting_finding_ids: opt([]), supporting_claim_ids: opt([]), contradicting_claim_ids: opt([]),
});
const PossibleOutcome = model("PossibleOutcome", { outcome: req(), implication: req() });
const MissingEvidence = model("MissingEvidence", {
  missing_id: req(), priority: req(), description: req(), why_it_matters: req(), check_existing_first: req(),
  existing_record_refs: opt([], list(RecordRef)), claim_ids: req(), hypothesis_ids: opt([]),
  possible_outcomes: opt([], list(PossibleOutcome)),
});
const ClinicianQuestion = model("ClinicianQuestion", { question_id: req(), text: req(), missing_ids: opt([]) });
const AnalysisOutput = model("AnalysisOutput", {
  findings: req(list(Finding)), claims: req(list(Claim)), prior_results: req(list(PriorResultReview)),
  hypotheses: req(list(Hypothesis)), missing_evidence: req(list(MissingEvidence)),
  clinician_questions: req(list(ClinicianQuestion)),
});

const SourceExcerpt = model("SourceExcerpt", { excerpt_id: req(), text: req(), location: opt(null) });
const Source = model("Source", {
  source_id: req(), source_type: req(), title: req(), publisher: req(), year: opt(null), url: req(),
  pmid: opt(null), excerpts: req(list(SourceExcerpt)), verification_status: req(), retrieved_on: opt(null),
});
const SourceRegistry = model("SourceRegistry", {
  schema_version: opt("source.v1"), evidence_version: req(), sources: req(list(Source)),
});

// Python compares str by code point; every ID and date here is ASCII, where < agrees.
const byKeys = (...keys) => (a, b) => {
  for (const key of keys) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
};

// ---------------------------------------------------------------- validation.py

const normalizeText = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

function findReferenceErrors(output, patient, sources) {
  const errors = [];
  const documents = new Map(patient.documents.map((d) => [d.record_id, d]));
  const excerpts = new Map(sources.map((s) => [s.source_id, new Set(s.excerpts.map((e) => e.excerpt_id))]));

  const unique = (kind, ids) => {
    const seen = new Set();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${kind} id '${id}'`);
      seen.add(id);
    }
    return seen;
  };
  const findingIds = unique("finding", output.findings.map((f) => f.finding_id));
  const claimIds = unique("claim", output.claims.map((c) => c.claim_id));
  const hypothesisIds = unique("hypothesis", output.hypotheses.map((h) => h.hypothesis_id));
  const missingIds = unique("missing_evidence", output.missing_evidence.map((m) => m.missing_id));
  unique("prior_result", output.prior_results.map((p) => p.prior_result_id));
  unique("question", output.clinician_questions.map((q) => q.question_id));

  const checkRecords = (where, refs) => {
    for (const ref of refs) {
      const doc = documents.get(ref.record_id);
      if (!doc) errors.push(`${where}: unknown or excluded record '${ref.record_id}'`);
      else if (!normalizeText(doc.text).includes(normalizeText(ref.excerpt))) {
        errors.push(`${where}: excerpt not verbatim in ${ref.record_id}: '${ref.excerpt}'`);
      }
    }
  };
  const checkIds = (where, ids, valid, kind) => {
    for (const id of ids) if (!valid.has(id)) errors.push(`${where}: unknown ${kind} '${id}'`);
  };

  for (const f of output.findings) checkRecords(f.finding_id, f.record_refs);
  for (const c of output.claims) {
    checkRecords(c.claim_id, c.record_refs);
    for (const ref of c.source_refs) {
      if (!excerpts.has(ref.source_id)) errors.push(`${c.claim_id}: unknown source '${ref.source_id}'`);
      else if (!excerpts.get(ref.source_id).has(ref.excerpt_id)) {
        errors.push(`${c.claim_id}: unknown excerpt '${ref.excerpt_id}' in ${ref.source_id}`);
      }
    }
  }
  for (const p of output.prior_results) {
    checkRecords(p.prior_result_id, p.record_refs);
    checkIds(p.prior_result_id, p.limitation_claim_ids, claimIds, "claim");
    checkIds(p.prior_result_id, p.hypothesis_ids, hypothesisIds, "hypothesis");
  }
  for (const h of output.hypotheses) {
    checkIds(h.hypothesis_id, h.supporting_finding_ids, findingIds, "finding");
    checkIds(h.hypothesis_id, [...h.supporting_claim_ids, ...h.contradicting_claim_ids], claimIds, "claim");
  }
  for (const m of output.missing_evidence) {
    checkRecords(m.missing_id, m.existing_record_refs);
    checkIds(m.missing_id, m.claim_ids, claimIds, "claim");
    checkIds(m.missing_id, m.hypothesis_ids, hypothesisIds, "hypothesis");
  }
  for (const q of output.clinician_questions) checkIds(q.question_id, q.missing_ids, missingIds, "missing_evidence");

  if (!output.hypotheses.some((h) => !h.is_rare_disease)) {
    errors.push("hypotheses must include at least one non-rare-disease alternative");
  }
  return errors;
}

// json.dumps(payload, sort_keys=True, separators=(",", ":")) with Python's default ensure_ascii=True.
function pythonJsonString(text) {
  const named = { '"': '\\"', "\\": "\\\\", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f" };
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const code = text.charCodeAt(i); // UTF-16 code unit: non-BMP becomes a surrogate pair, as in Python
    if (named[ch]) out += named[ch];
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else out += `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return `${out}"`;
}

function pythonJsonDumps(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new Error(`float ${value} is not reproduced; Python formats floats differently`);
    return String(value);
  }
  if (typeof value === "string") return pythonJsonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonJsonDumps).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${pythonJsonString(key)}:${pythonJsonDumps(value[key])}`).join(",")}}`;
}

function computeCacheKey(patient, excludedRecordIds, { schemaVersion, model, promptVersion, evidenceVersion }) {
  const canonical = pythonJsonDumps({
    patient,
    excluded_record_ids: [...excludedRecordIds].sort(),
    schema_version: schemaVersion,
    model,
    prompt_version: promptVersion,
    evidence_version: evidenceVersion,
  });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

// ---------------------------------------------------------------- views.py

function buildTimeline(output, patient) {
  const findingsByRecord = new Map();
  for (const f of output.findings) {
    for (const ref of f.record_refs) {
      const ids = findingsByRecord.get(ref.record_id) ?? [];
      if (!ids.includes(f.finding_id)) ids.push(f.finding_id);
      findingsByRecord.set(ref.record_id, ids);
    }
  }
  return [...patient.documents].sort(byKeys("date", "record_id")).map((d) => ({
    record_id: d.record_id,
    date: d.date,
    specialty: d.specialty,
    title: d.title,
    finding_ids: findingsByRecord.get(d.record_id) ?? [],
  }));
}

function buildGraph(output) {
  const nodes = [];
  const edges = [];
  const linked = new Set(output.hypotheses.flatMap((h) => h.supporting_finding_ids));
  for (const f of output.findings) {
    if (linked.has(f.finding_id)) nodes.push({ node_id: f.finding_id, type: "finding", label: f.label });
  }
  for (const h of output.hypotheses) nodes.push({ node_id: h.hypothesis_id, type: "hypothesis", label: h.name });
  for (const p of output.prior_results) {
    nodes.push({ node_id: p.prior_result_id, type: "prior_result", label: p.test_name });
  }
  for (const m of output.missing_evidence) {
    nodes.push({ node_id: m.missing_id, type: "missing_evidence", label: m.description });
  }

  const edge = (source, target, relation) =>
    edges.push({ edge_id: `${source}--${relation}--${target}`, source, target, relation });
  for (const h of output.hypotheses) for (const fid of h.supporting_finding_ids) edge(fid, h.hypothesis_id, "supports");
  for (const p of output.prior_results) for (const hid of p.hypothesis_ids) edge(p.prior_result_id, hid, "previously_tested");
  for (const m of output.missing_evidence) for (const hid of m.hypothesis_ids) edge(m.missing_id, hid, "would_clarify");
  return { nodes, edges };
}

// ---------------------------------------------------------------- main.py:get_fixture_analysis

const readJson = (...parts) => JSON.parse(readFileSync(join(DATA_DIR, ...parts), "utf8"));

function buildFixtureRun(patientId) {
  const output = AnalysisOutput(readJson("fixtures", `${patientId}.analysis-output.json`));
  const patient = PatientRecord(readJson("patients", `${patientId}.json`));
  patient.documents.sort(byKeys("date", "record_id"));
  const registry = SourceRegistry(readJson("sources.json"));
  registry.sources.sort(byKeys("source_id"));

  const errors = findReferenceErrors(output, patient, registry.sources);
  if (errors.length) throw new Error(`fixture is out of date with the stored data:\n  - ${errors.join("\n  - ")}`);

  const versions = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    model: "hand-authored-fixture",
    prompt: "none",
    evidence: registry.evidence_version,
  };
  const run = {
    schema_version: ANALYSIS_SCHEMA_VERSION,
    run_id: `fixture-${patientId}`,
    status: "completed",
    provenance: "fixture",
    replayed_from_run_id: null,
    fallback_reason: null,
    evidence_mode: "cached",
    patient_id: patientId,
    record_version: patient.record_version,
    excluded_record_ids: [],
    cache_key: computeCacheKey(patient, [], {
      schemaVersion: versions.schema_version,
      model: versions.model,
      promptVersion: versions.prompt,
      evidenceVersion: versions.evidence,
    }),
    versions,
    created_at: FIXTURE_TIMESTAMP,
    completed_at: FIXTURE_TIMESTAMP,
    error: null,
    output,
    timeline: buildTimeline(output, patient),
    graph: buildGraph(output),
    disclaimer: DISCLAIMER,
  };

  const cited = [...new Set(output.claims.flatMap((c) => c.source_refs.map((r) => r.source_id)))];
  const sources = Object.fromEntries(
    cited.map((id) => [id, registry.sources.find((s) => s.source_id === id)]),
  );
  return { run, patient, sources };
}

const patientId = process.argv[2] ?? "sarah-001";
const { run, patient, sources } = buildFixtureRun(patientId);
const write = (name, value) => {
  writeFileSync(join(OUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote fixtures/${name}`);
};
mkdirSync(OUT_DIR, { recursive: true });
write(`${patientId}.run.json`, run);
write(`${patientId}.patient.json`, patient);
write("sources.json", sources);
