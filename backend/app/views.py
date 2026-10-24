"""Timeline and clue graph derived from a validated analysis.

Built deterministically so the frontend never depends on the LLM for structure,
and so the graph always agrees with the analysis it came from.
"""

from __future__ import annotations

from collections.abc import Iterable

from .contracts import AnalysisOutput, ClueGraph, GraphEdge, GraphNode, PatientRecord, TimelineEvent


def build_timeline(
    output: AnalysisOutput, patient: PatientRecord, excluded_record_ids: Iterable[str] = ()
) -> list[TimelineEvent]:
    excluded = set(excluded_record_ids)
    findings_by_record: dict[str, list[str]] = {}
    for f in output.findings:
        for ref in f.record_refs:
            ids = findings_by_record.setdefault(ref.record_id, [])
            if f.finding_id not in ids:
                ids.append(f.finding_id)

    docs = sorted(
        (d for d in patient.documents if d.record_id not in excluded),
        key=lambda d: (d.date, d.record_id),
    )
    return [
        TimelineEvent(
            record_id=d.record_id,
            date=d.date,
            specialty=d.specialty,
            title=d.title,
            finding_ids=findings_by_record.get(d.record_id, []),
        )
        for d in docs
    ]


def build_graph(output: AnalysisOutput) -> ClueGraph:
    """Only findings that support a hypothesis become nodes, keeping the graph small."""
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []

    linked = {fid for h in output.hypotheses for fid in h.supporting_finding_ids}
    for f in output.findings:
        if f.finding_id in linked:
            nodes.append(GraphNode(node_id=f.finding_id, type="finding", label=f.label))
    for h in output.hypotheses:
        nodes.append(GraphNode(node_id=h.hypothesis_id, type="hypothesis", label=h.name))
    for p in output.prior_results:
        nodes.append(GraphNode(node_id=p.prior_result_id, type="prior_result", label=p.test_name))
    for m in output.missing_evidence:
        nodes.append(GraphNode(node_id=m.missing_id, type="missing_evidence", label=m.description))

    def edge(source: str, target: str, relation: str) -> None:
        edges.append(GraphEdge(
            edge_id=f"{source}--{relation}--{target}", source=source, target=target, relation=relation
        ))

    for h in output.hypotheses:
        for fid in h.supporting_finding_ids:
            edge(fid, h.hypothesis_id, "supports")
    for p in output.prior_results:
        for hid in p.hypothesis_ids:
            edge(p.prior_result_id, hid, "previously_tested")
    for m in output.missing_evidence:
        for hid in m.hypothesis_ids:
            edge(m.missing_id, hid, "would_clarify")

    return ClueGraph(nodes=nodes, edges=edges)
