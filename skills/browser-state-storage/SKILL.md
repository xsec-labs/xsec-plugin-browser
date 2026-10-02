---
name: browser-state-storage
description: Inspect or modify session-scoped cookies and web storage with precise browser tool calls.
---

# Browser State and Storage

Use this Skill for cookies, localStorage, sessionStorage, and storage-state inspection or mutation. Browser state is session-scoped sensitive material, not a portable convenience cache.

1. Confirm both `browser_session_id` and stable `page_id`. State requests that omit one are prone to act on the wrong origin or session and must be corrected rather than guessed.
2. Identify a cookie precisely by name, domain, path, and partition key whenever applicable. Use the `browser_cookie_*` tools for cookie operations and the matching `browser_localstorage_*` or `browser_sessionstorage_*` tools for origin storage.
3. Before reading sensitive state, state its task purpose. Keep values, tokens, Cookie headers, and full storage dumps out of logs, messages, replay steps, screenshots, and reports.
4. After a mutation, inspect `completed`/`affected` and re-read only the needed key or cookie metadata to verify the result. Treat a missing target, an affected count of zero, or a stale page as an explicit failure.
5. Close the session when the task ends. Never automatically copy login state, storage, or downloads to another page group, another agent, or a v3 session created by upgrade.

Read [state and storage safeguards](references/tool-contract.md) when handling partitioned cookies or deciding what may enter replay evidence.
