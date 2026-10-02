# Browser Contract v3

The server advertises 53 `browser_*` tools. The session tools are `browser_session_create`, `browser_session_get`, and `browser_session_close`. The server is authoritative for input schemas and error envelopes. In hosted mode, task identity, page-group access, proxy leases, and evidence authority come from the opaque Host context, never Tool arguments.
