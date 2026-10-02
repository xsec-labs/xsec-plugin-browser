---
name: browser-page-evaluate
description: Run bounded JSON-only JavaScript in the selected browser page context.
---

# Browser Page Evaluate

Use `browser_evaluate` only when a small calculation or structured read genuinely needs page JavaScript. It executes in the chosen page context; it is not a shell, browser-extension, filesystem, credential-store, or Host RPC escape hatch.

1. Confirm the exact stable `page_id` and first prefer snapshot, locator, storage, or verification tools when they express the task.
2. Supply a small function source and JSON-only arguments. Set a timeout appropriate to the operation and make the return value a JSON value, not a DOM node, function, cyclic graph, stream, or browser handle.
3. Treat a timeout, serialization failure, result limit, or bridge policy rejection as the final operation result. Do not retry with a larger payload, a polling loop, injected Worker, Service Worker, WebTransport, WebRTC, or a different execution context.

The function source limit is 64 KiB and returned JSON is limited to 1 MiB. The bridge continues to apply its transport policy to Worker-family APIs. Record only a small sanitized result in a replay step. Read [evaluate boundaries](references/tool-contract.md) before using this tool for an unfamiliar page API.
