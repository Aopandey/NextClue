import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import patientJson from "@/fixtures/sarah-001.patient.json";
import runJson from "@/fixtures/sarah-001.run.json";
import sourcesJson from "@/fixtures/sources.json";
import sarahLiveJson from "@/fixtures/live/sarah-001.run.json";
import type { AnalysisRun, PatientRecord, Source } from "@/lib/contracts";
import { DetailPanel } from "../DetailPanel";

const run = runJson as AnalysisRun;
const patient = patientJson as PatientRecord;
const sources = sourcesJson as Record<string, Source>;
const sarahLive = sarahLiveJson as AnalysisRun;

function renderPanel(nodeId: string, narrow = false) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  const user = userEvent.setup();
  render(<DetailPanel run={run} patient={patient} sources={sources} nodeId={nodeId} onClose={onClose} onSelect={onSelect} narrow={narrow} />);
  return { onClose, onSelect, user };
}

const openDetails = (name: string) => {
  const summary = screen.getByText(name, { selector: "summary" });
  summary.closest("details")!.open = true;
};
const lines = () => screen.getByTestId("condensed").children.length;

describe.each([false, true])("DetailPanel (narrow=%s)", (narrow) => {
  it("opens with the node's label", () => {
    renderPanel("fnd-cornea-verticillata", narrow);
    expect(screen.getByRole(narrow ? "dialog" : "complementary")).toBeInTheDocument();
  });

  it("Escape closes", async () => {
    const { onClose, user } = renderPanel("fnd-proteinuria", narrow);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("Close button closes and is at least 40px", async () => {
    const { onClose, user } = renderPanel("fnd-proteinuria", narrow);
    const close = screen.getByRole("button", { name: "Close" });
    expect(close.className).toContain("size-10");
    await user.click(close);
    expect(onClose).toHaveBeenCalled();
  });

  it("Close sits outside the scrolling body, so it never scrolls out of view", () => {
    renderPanel("hyp-fabry", narrow);
    const close = screen.getByRole("button", { name: "Close" });
    const scroller = screen.getByTestId("panel-scroll");
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.contains(close)).toBe(false);
    const panel = screen.getByRole(narrow ? "dialog" : "complementary");
    expect(panel.contains(close)).toBe(true);
    expect(panel.className).not.toContain("overflow-y-auto");
  });
});

describe("DetailPanel content", () => {
  it("finding panel: 4 lines with verbatim quote and NBK citation link", () => {
    renderPanel("fnd-cornea-verticillata");
    expect(screen.getByText(/“bilateral whorl-like corneal opacities \(cornea verticillata\)”/)).toBeInTheDocument();
    expect(screen.getByText("19 Apr 2023 · ophthalmology")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /NBK1292/ })).toHaveAttribute("href", "https://www.ncbi.nlm.nih.gov/books/NBK1292/");
    expect(screen.getByText("Unverified paraphrase")).toBeInTheDocument();
    expect(lines()).toBeLessThanOrEqual(4);
  });

  it("prior panel shows what_it_established and PMID-free citation", () => {
    renderPanel("pri-enzyme-2016");
    expect(screen.getByText(/Enzyme activity was not low/)).toBeInTheDocument();
    expect(screen.queryByText(/PMID \d/)).toBeNull();
  });

  it("missing panel quotes the existing record and explains why", () => {
    renderPanel("mis-gla-report");
    expect(within(screen.getByTestId("condensed")).getByText(/no report from that visit is in our chart/)).toBeInTheDocument();
    expect(screen.getByText(/Molecular testing identifies heterozygous females/)).toBeInTheDocument();
  });

  it("hub panel computes the supporting count and specialties", () => {
    renderPanel("hyp-fabry");
    expect(screen.getByText("7 supporting findings across 5 specialties")).toBeInTheDocument();
    expect(lines()).toBeLessThanOrEqual(4);
  });

  it("placeholder source shows PMID pending + Search PubMed", () => {
    renderPanel("hyp-separate-conditions");
    openDetails("More about this disease");
    expect(screen.getAllByText("PMID pending").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Search PubMed/ })[0]).toHaveAttribute("href", expect.stringMatching(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/));
    expect(document.body.textContent).not.toContain("PLACEHOLDER");
  });

  it("negative finding with no linking claim omits the citation line", () => {
    const bare = { ...run, output: { ...run.output!, claims: [] } };
    render(<DetailPanel run={bare} patient={patient} sources={sources} nodeId="fnd-diabetes-absent" onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(within(screen.getByTestId("condensed")).getByText(/^“HbA1c 5\.2%”/)).toBeInTheDocument();
    expect(screen.queryByTestId("citation")).toBeNull();
  });

  const why = () => within(screen.getByTestId("condensed")).queryByText("Why it matters:")?.parentElement?.textContent ?? null;
  const citation = () => screen.queryByTestId("citation")?.textContent ?? null;

  it("finding sharing a record with other claims gets the claim whose excerpt matches (father → inheritance)", () => {
    renderPanel("fnd-father-dialysis");
    expect(why()).toMatch(/X-linked|inherit/i);
    expect(why()).not.toMatch(/proteinuria/i);
    expect(citation()).toContain("Genetic Counseling");
  });

  it("proteinuria keeps the kidney claim (record-only fallback for present findings)", () => {
    renderPanel("fnd-proteinuria");
    expect(why()).toMatch(/proteinuria/i);
    expect(citation()).toContain("Clinical Description");
  });

  it.each(["fnd-celiac-negative", "fnd-diabetes-absent"])("negative %s with no claim of its own shows no why and no citation", (id) => {
    renderPanel(id);
    expect(why()).toBeNull();
    expect(citation()).toBeNull();
  });

  it("a missing item with nothing to quote renders no Source quote disclosure", () => {
    const blank = structuredClone(sources);
    blank["src-genereviews-fabry"].excerpts!.forEach((e) => { e.text = "[Unverified paraphrase]   "; });
    render(<DetailPanel run={run} patient={patient} sources={blank} nodeId="mis-father-diagnosis" onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByText("Source quote", { selector: "summary" })).toBeNull();
    const noClaim = structuredClone(run);
    noClaim.output!.missing_evidence.find((m) => m.missing_id === "mis-father-diagnosis")!.claim_ids = [];
    document.body.innerHTML = "";
    render(<DetailPanel run={noClaim} patient={patient} sources={sources} nodeId="mis-father-diagnosis" onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.queryByText("Source quote", { selector: "summary" })).toBeNull();
  });

  it("outcome rows render without duplicate-key warnings when two outcomes share text", () => {
    const dup = structuredClone(run);
    const gla = dup.output!.missing_evidence.find((m) => m.missing_id === "mis-gla-report")!;
    gla.possible_outcomes = [gla.possible_outcomes[0], { ...gla.possible_outcomes[0] }];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DetailPanel run={dup} patient={patient} sources={sources} nodeId="hyp-fabry" onClose={vi.fn()} onSelect={vi.fn()} />);
    const keyWarnings = error.mock.calls.filter((c) => String(c[0]).includes("same key"));
    error.mockRestore();
    expect(keyWarnings).toEqual([]);
    expect(screen.getAllByTestId("outcome-row").length).toBeGreaterThanOrEqual(2);
  });

  it("disclosures are closed by default", () => {
    renderPanel("hyp-fabry");
    document.querySelectorAll("details").forEach((d) => expect(d.open).toBe(false));
  });

  it("More about this record shows full text with the excerpt marked and the observations table", () => {
    renderPanel("fnd-proteinuria");
    openDetails("More about this record");
    expect(document.querySelector("mark")?.textContent).toBe("Urine albumin-to-creatinine ratio 410 mg/g");
    const table = screen.getByRole("table");
    ["Name", "Value", "Reference", "Interpretation"].forEach((h) => expect(within(table).getByText(h)).toBeInTheDocument());
  });

  it("Also in this record selects the sibling finding", async () => {
    const { onSelect, user } = renderPanel("fnd-proteinuria");
    openDetails("More about this record");
    await user.click(screen.getByRole("button", { name: /father/i }));
    expect(onSelect).toHaveBeenCalledWith("fnd-father-dialysis");
  });

  it("Source quote shows the stripped quote with its location", () => {
    renderPanel("fnd-cornea-verticillata");
    openDetails("Source quote");
    expect(screen.getByText(/^“Classic features include/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("[Unverified paraphrase]");
    expect(screen.getAllByText("Clinical Description").length).toBeGreaterThan(0);
  });

  it("More about this disease lists 7 supporting findings and 3 possible outcomes for GLA", () => {
    renderPanel("hyp-fabry");
    openDetails("More about this disease");
    expect(screen.getAllByTestId("supporting-finding")).toHaveLength(7);
    expect(screen.getAllByTestId("outcome-row").length).toBeGreaterThanOrEqual(3);
    const outcomes = screen.getAllByRole("table")[0];
    expect(within(outcomes).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Outcome", "What it would mean"]);
    expect(screen.getByText(/2019 outside genetics clinic report/)).toBeInTheDocument();
  });

  it("every link opens safely", () => {
    renderPanel("hyp-separate-conditions");
    screen.getAllByRole("link").forEach((a) => {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a).toHaveAttribute("rel", "noopener noreferrer");
      expect(a.textContent).toMatch(/↗$/);
    });
  });

  it("renders nothing for an unknown node", () => {
    renderPanel("nope");
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  const show = (r: AnalysisRun, nodeId: string) =>
    render(<DetailPanel run={r} patient={patient} sources={sources} nodeId={nodeId} onClose={vi.fn()} onSelect={vi.fn()} />);

  it("a finding with no claim of its own never borrows another finding's claim on the same record (live fnd-06)", () => {
    show(sarahLive, "fnd-06");
    expect(why()).toBeNull();
    expect(citation()).toBeNull();
    document.body.innerHTML = "";
    show(sarahLive, "fnd-05");
    expect(why()).toMatch(/short PR interval/);
  });

  it("hub Why it matters is capped at 14 words", () => {
    show(sarahLive, "hyp-01");
    const text = why()!.replace("Why it matters:", "").trim();
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(14);
    expect(text.endsWith("…")).toBe(true);
  });

  it("More about this disease lists missing evidence by priority, 1 first, with its number", () => {
    const r = structuredClone(run);
    const [a, b] = r.output!.missing_evidence;
    a.priority = 2;
    b.priority = 1;
    b.hypothesis_ids = ["hyp-fabry"];
    show(r, "hyp-fabry");
    openDetails("More about this disease");
    const items = [...document.querySelectorAll("[data-testid=missing-item]")].map((el) => el.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain(b.description);
    expect(items[0]).toContain("Priority 1");
    expect(items[1]).toContain(a.description);
    expect(items[1]).toContain("Priority 2");
  });

  it("empty lists render no heading or empty table", () => {
    const r = structuredClone(run);
    const fabry = r.output!.hypotheses.find((h) => h.hypothesis_id === "hyp-fabry")!;
    fabry.supporting_finding_ids = [];
    r.output!.missing_evidence.forEach((m) => { m.possible_outcomes = []; });
    show(r, "hyp-fabry");
    openDetails("More about this disease");
    expect(screen.queryByText("Supporting findings")).toBeNull();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });

  it("an uncertain finding says so in its meta line", () => {
    const r = structuredClone(run);
    r.output!.findings.find((f) => f.finding_id === "fnd-proteinuria")!.assertion = "uncertain";
    show(r, "fnd-proteinuria");
    expect(screen.getByText("8 Nov 2021 · nephrology · Uncertain")).toBeInTheDocument();
  });
});
