# com.xsec.workspace.browser

This is the public source repository for `com.xsec.workspace.browser`. It was materialized from
the immutable signed XSEC Marketplace release during the first-party source
migration. Develop on `beta`; merge reviewed, tested changes to `main` for the
Stable source line.

Marketplace artifacts, release indexes, signatures, and Factory adoption proof
remain in [xsec-labs/xsec-plugins](https://github.com/xsec-labs/xsec-plugins).
This source repository never stores Factory credentials or KMS material.

Source repository: <https://github.com/xsec-labs/xsec-plugin-browser>

## Frontend development

`frontend-src` renders the workspace tool and Chrome settings with the shared
XSEC React components and design tokens. Host color mode, density, font size and
reduced motion settings apply to both surfaces. The browser controller owns the
session, control lease, page selection, canvas stream and input state; the React
view renders its current snapshot.

Use Node.js 22 and the checked-in npm lockfile:

```sh
npm ci
npm run build
npm run validate
```

`build` generates the manifest's single ESM frontend entry, third-party notices
and a CycloneDX frontend SBOM. `validate` checks TypeScript, protocol parsing,
dual manifest versions, declared capabilities, the 20 frontend RPC methods,
53 MCP tools, eight skills and the v3 contract digest. It also rebuilds into a
temporary directory to compare all three generated artifacts with source.
The JPEG parser fixture was captured from a Chromium page over loopback HTTP;
its producer, dimensions and SHA-256 are recorded alongside it.

The MCP executable declared in `mcp.json` is supplied by the platform artifact.
Its source belongs to the Desktop `xsec-browser-mcp` crate. Local Host validation
requires the matching executable at `bin/browser-mcp`, isolated runtime data and
the plugin development workspace's permission and native execution confirmation.
Verify actual canvas frames, exact sequence acknowledgements, keyboard/IME,
control handover, settings persistence, reload/disposal and all three development
log sources on the real Desktop Host. Select additional platform runs according
to the changed native or Host boundary.
