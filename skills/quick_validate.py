#!/usr/bin/env python3
"""Small deterministic validation for the browser Skill bundle."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
EXPECTED = {
    "browser-session-lifecycle", "browser-navigation-tabs", "browser-locator-interaction",
    "browser-forms-dialogs", "browser-state-storage", "browser-page-evaluate",
    "browser-network-console", "browser-evidence-replay",
}
actual = {path.name for path in ROOT.iterdir() if path.is_dir()}
if actual != EXPECTED:
    raise SystemExit(f"unexpected browser Skills: {sorted(actual)}")
for name in sorted(EXPECTED):
    skill = ROOT / name
    text = (skill / "SKILL.md").read_text(encoding="utf-8")
    if not text.startswith("---\nname: ") or "description:" not in text:
        raise SystemExit(f"invalid SKILL.md: {name}")
    if not (skill / "references" / "tool-contract.md").is_file() and name != "browser-session-lifecycle":
        raise SystemExit(f"missing detailed contract reference: {name}")
    if name == "browser-session-lifecycle" and not (skill / "references" / "contract.md").is_file():
        raise SystemExit("missing lifecycle contract reference")
print(f"validated {len(EXPECTED)} browser Skills")
