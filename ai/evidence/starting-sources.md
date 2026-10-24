# Evidence registry review record

The canonical registry is `backend/data/sources.json`, now **`evidence-2026-10-24.1`**.
It replaces `evidence-draft-1` (unverified paraphrases plus a placeholder paper).
Reviewed October 24, 2026 by Avinash with Kiro. Every excerpt is an exact quotation;
the registry was re-checked mechanically with:

```powershell
.\.venv\Scripts\python.exe -m ai.evidence_tool genereviews-copy fabry --out $env:TEMP\nextclue-review
.\.venv\Scripts\python.exe -m ai.evidence_tool check --online --fulltext "src-genereviews-fabry=$env:TEMP\nextclue-review\fabry.nxml"
```

Result: 4/4 sources, 23/23 excerpts verbatim in the checked original. Verbatim
checks confirm wording, not clinical applicability; that judgment is noted below.

## Sources

| Source ID | What it is | Checked against |
| --- | --- | --- |
| `src-genereviews-fabry` | Mehta A, Hughes DA. Fabry Disease. GeneReviews, revised 2024-04-11. NBK1292, PMID 20301469 | Chapter XML `fabry.nxml` from NCBI's literature archive `gene_NBK1116.tar.gz` (dated 2026-10-22), SHA-256 `4f75d183…69313a`; summary excerpts also against the PubMed abstract |
| `src-sfn-review` | de Greef BTA et al. Associated conditions in small fiber neuropathy: a large cohort study and review of the literature. Eur J Neurol 2018. PMID 29112785 | PubMed abstract |
| `src-fabry-female-strategy` | Balendran S et al. Diagnostic strategy for females suspected of Fabry disease. Clin Genet 2020. PMID 31860127 | PubMed abstract |
| `src-ada-diabetic-neuropathy` | Pop-Busui R et al. Diabetic Neuropathy: A Position Statement by the ADA. Diabetes Care 2017. PMID 27999003 | PMC6977405 full text (no PubMed abstract) |

The NCBI Bookshelf page itself returned a browser check, so the chapter was read
from NCBI's own archive copy. The review copy stays outside the repository.

## ID decisions

Kept, same meaning, now exact text: `exc-fabry-female-enzyme`, `exc-fabry-features`,
`exc-fabry-kidney`, `exc-fabry-inheritance`, `exc-sfn-causes`, `src-sfn-review`.

Kept, narrower than the old paraphrase (Daniel and Mike: the fixture still resolves):

- `exc-fabry-phenocopy` now supports amiodarone only. The chapter does not
  mention chloroquine corneal phenocopy; the old paraphrase did.
- `exc-fabry-features` (classic onset sentence) no longer lists GI symptoms.
  GI symptoms are now `exc-fabry-gi`.
- `exc-fabry-inheritance` is the mode-of-inheritance sentence. Father-to-daughter
  transmission is now `exc-fabry-father-daughters`.
- `src-sfn-review` was a placeholder; it is now the de Greef 2018 cohort and review.

Added: `exc-fabry-female-molecular`, `exc-fabry-male-enzyme`, `exc-fabry-vus`,
`exc-fabry-suspicion`, `exc-fabry-female-features`, `exc-fabry-angiokeratoma`,
`exc-fabry-sfn`, `exc-fabry-gi`, `exc-fabry-female-kidney`, `exc-fabry-cardiac`,
`exc-fabry-father-daughters`, `exc-fabry-family-history`, and the two new sources.

## Applicability notes for clinicians and reviewers

- de Greef 2018 is a single Dutch referral cohort (921 patients) screened with a
  standardized algorithm; its 53% figure is not a general prevalence.
- Balendran 2020 reports dried-blood-spot enzyme plus lyso-Gb3 testing; authors
  include laboratory and manufacturer affiliations. Sarah's 2016 test was a
  leukocyte assay, so its findings apply only by analogy.
- Several GeneReviews excerpts are sex-specific (`female-*`, `male-enzyme`). The
  handoff prompt requires checking that before citing.
- Treatment text in the chapter was deliberately not registered.

## Adding evidence

`python -m ai.evidence_tool search "..."` lists candidate PMIDs only. `add` writes a
verbatim abstract excerpt as **unverified** and requires a new `evidence_version`.
A reviewer then reads the source, marks it verified, and coordinates re-seeding.
Runs never see unregistered search results.
