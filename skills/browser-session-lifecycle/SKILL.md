---
name: browser-session-lifecycle
description: Create, inspect, close, or explicitly upgrade a browser session through the browser MCP server.
---

# Browser Session Lifecycle

Use the official `browser` MCP server for session creation, health checks, closure, and explicit v2-to-v3 upgrades. Do not use this Skill for page interactions once a stable page ID is known; route those requests to the relevant page Skill.

1. Call `browser_get_config` and confirm the selected runtime mode. In standalone mode, Chrome, the packed Node runtime, roots, proxy configuration, and policy must already be valid. In hosted mode, treat the Desktop context handle as opaque and never provide assignment, project, role, owner, or lease fields as identity.
2. Call `browser_session_create` once, retain the returned `browser_session_id`, then call `browser_session_get`. Read the contract version, process/CDP health, proxy state, and, in hosted mode, Host status.
3. Call `browser_tabs` and retain an explicit stable `page_id` for later work. Do not infer a current page from tab ordering.
4. At the end of work, call `browser_session_close` even after an operation failure. The close result must confirm that browser and session cleanup was requested; preserve an explicit cleanup error instead of calling another create as a recovery shortcut.

`xsec_browser_*` session names and the old screenshot/select/wait aliases are not v3 tools. A historical session may be read or closed, but continued operation returns `contract_upgrade_required`. Tell the user that upgrade creates a fresh v3 session and page group; by default it does not copy cookies, web storage, profiles, or downloads. Never guess an old session ID or apply it to the new contract.

Read [the lifecycle contract](references/contract.md) before diagnosing health or explaining an upgrade.
