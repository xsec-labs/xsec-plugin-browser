# Official plugin bridge

This package owns the signed plugin manifest, permissions and release lifecycle. Once it is installed and enabled, XSEC Desktop loads its frontend in an opaque iframe and grants only the manifest-declared Host RPC methods.

The browser workspace tool receives a private, capability-bound surface bridge: the host validates the project/session/page at open time, associates one native Chrome surface with one iframe, and forwards JPEG frames on that iframe's private data stream. Surface input, frame acknowledgements, close, and Desktop-level focus presentation must match that handle. The package frontend is the workspace renderer.

Version 3.1.0 confirms presentation through `xsec.browser.surface.presented` with
`{ surfaceId, sequence }`. The sequence is the positive little-endian uint32 in
the existing XSBF frame header. The frontend sends it after JPEG decoding and
canvas drawing succeed, and releases the bitmap on every exit. The Host rejects
an older, future, duplicate or invalid sequence while retaining the current
pending frame and its deadline. Failed presentation reaches the existing surface
failure and close path.

This method requires a Host that supports exact frame presentation. Older Hosts
reject the undeclared method. Updated Hosts diagnose the former
`xsec.browser.surface.acknowledge` call as requiring Browser 3.1.0 or later.
Deploy the updated Host and this plugin together; Marketplace publication and
installation use the normal signed package lifecycle. The MCP browser contract,
XSBF binary header and portable package format remain unchanged.

The frontend declares back navigation as `xsec.browser.mcp.navigate-back`, bound
to the unchanged `browser_navigate_back` MCP tool and `browser.control` permission.

The manifest also owns the browser settings page and its `pluginData` RPC grants, so installing the package restores both the workspace browser and its custom Chrome-path setting.

The root manifest uses Agent Plugins v1 with a `com.xsec.desktop` schema v2 extension. Version 3 declares the official `browser` stdio MCP server, 53 contract-bound `browser_*` tools, and eight portable browser Skills. The sidecar owns Chrome/CDP/Playwright; Desktop keeps task identity, page groups, proxy leases, approvals, evidence, surfaces, and trusted artifact validation. Hosted calls always use the capability-bound Host RPC context and never fall back to standalone execution.
