---
name: browser-evidence-replay
description: Capture bounded browser evidence and record reproducible browser action sequences.
---

# Browser Evidence and Replay

Use this Skill to capture a screenshot or PDF, perform an approved file upload/download, and express a browser observation as replayable steps. Evidence records are immutable observations, not a channel for arbitrary files or sensitive browser state.

1. Confirm the selected stable page and the operation result before capture. Use `browser_snapshot` when a small structural record is needed beside the visual artifact.
2. Use `browser_take_screenshot` or `browser_pdf_save` with a safe filename. Record the returned evidence ID, content type, size, and SHA-256. In hosted mode the sidecar writes chunks through Host evidence RPC; in standalone mode it returns a private plugin-data path plus the same integrity metadata.
3. An upload in hosted mode must use a Host-approved staging reference. Do not pass an arbitrary local path. In standalone mode, a path must be within the configured upload root. Apply single-file, aggregate, and inline-base64 limits from the tool contract.
4. Store replay steps as: navigation or precondition; `page_id`; locator or explicitly justified coordinates; action and inputs; observable verification; evidence ID. Never put Cookie values, tokens, full storage, or raw upload paths in those steps.
5. Close the session and report cleanup status for profile, downloads, Chrome/bridge, and proxy lease.

Screenshots and PDFs are capped at 16 MiB. Evidence persistence failures must retain the evidence ID and failing stage; do not report a capture as durable before commit succeeds. Read [evidence and replay limits](references/tool-contract.md) for the required integrity fields.
