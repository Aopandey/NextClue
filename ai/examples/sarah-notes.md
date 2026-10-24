# Canonical patient input

The earlier Markdown example is retired. Use Daniel's
[Sarah JSON](../../backend/data/patients/sarah-001.json) and its real `rec-...`
IDs, dates, text, and demographics. The current birth year is 1986; the enzyme
screen is from 2016; a 2024 note mentions an outside genetics visit in 2019.
Use the actual family history, not the earlier illustrative notes.

[James](../../backend/data/patients/james-002.json) is the common-cause control.
The hand-authored analysis fixture is only for UI development. Never present it
as a model run. Fresh local model output goes to ignored `ai/runs/`.
