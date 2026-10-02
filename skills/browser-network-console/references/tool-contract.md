# Page-level network observations

`browser_network_requests` emits an index. `browser_network_request` reads one
index with `part=request|response|all`; it can report `headers_pending` while
waiting up to `header_timeout_ms`. A missing index is `not_found`.

The index does not replace proxy traffic capture or prove that a full request
and response payload were preserved. Use the traffic plugin for that evidence.
