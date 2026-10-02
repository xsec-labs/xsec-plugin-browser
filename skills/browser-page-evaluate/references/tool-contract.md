# Evaluate boundaries

`browser_evaluate` accepts a page-context function with JSON arguments. Source
is at most 64 KiB and JSON output at most 1 MiB. DOM nodes, cyclic objects,
functions, and oversized results fail serialization.

The execution context cannot access shell commands, files, keychains, or Host
RPC. The bridge keeps Worker, SharedWorker, Service Worker, WebTransport, and
WebRTC constrained by its transport policy.
