---
name: browser-navigation-tabs
description: Navigate browser pages, manage tabs and popups, and wait for observable page state.
---

# Browser Navigation and Tabs

Use this Skill for navigation, history, tabs, popups, and observable waiting. It deliberately treats a page ID as an opaque stable identity rather than a DOM index or the browser's selected tab.

1. Start with `browser_tabs`; choose a returned `page_id` explicitly. If none is suitable, create or navigate a page only through the contract tools.
2. Before `browser_navigate`, verify that the destination is an HTTP or HTTPS URL with a host. Hosted navigation is separately approved by Desktop policy; do not attempt to substitute a redirect, `file:`, `data:`, or `javascript:` URL.
3. For an action that may open a popup, set `follow_new_tab` on the triggering click, then call `browser_tabs` again. The returned page ID—not its numerical tab position—identifies the popup. A new tab is not automatically the parent or main page.
4. Use `browser_wait_for` with a meaningful load state, locator, or text. Do not use a guessed fixed delay as success evidence. After `browser_close`, reload `browser_tabs` before choosing another page.

On failure, retain the attempted URL, the stable page ID, phase, and returned error code. Do not silently retry the same navigation, fall back to a different URL, or use a new tab to bypass a rejected navigation. See [tab and navigation details](references/tool-contract.md) when a popup or wait result is ambiguous.
