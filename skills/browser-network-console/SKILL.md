---
name: browser-network-console
description: Inspect browser console output and indexed page-level network observations.
---

# Browser Network and Console

Use this Skill for page-scoped console diagnostics and the browser's indexed request observation. It is not a replacement for proxy capture, replay, or full HTTP evidence analysis.

1. Call `browser_console_messages` to inspect page console output. Keep messages scoped to the selected session/page and avoid copying secrets from page output into reports.
2. Call `browser_network_requests` first. It returns a request index, not a complete traffic archive.
3. Select one returned index and call `browser_network_request` with `part=request`, `response`, or `all`. Use `header_timeout_ms` when response headers may arrive after the index record.
4. `headers_pending` is incomplete observation, not a successful response. A missing request index is `not_found`; do not pick a neighbouring index or guess based on request ordering.

If the task needs full request/response bodies, proxy association, passive detection, replay, or a durable traffic artifact, hand it to the traffic plugin with the relevant IDs. Read [network observation limits](references/tool-contract.md) for the evidence boundary.
