---
name: browser-locator-interaction
description: Reliably locate and interact with page controls through snapshots and strict browser locators.
---

# Browser Locator Interaction

Use this Skill for direct page control: snapshotting, locator generation, click/hover/drag/type, keys, pointer input, and viewport changes. It is built around strict locators, so an ambiguous target is a failure to resolve—not an invitation to broaden a selector.

1. Call `browser_snapshot` for the selected stable `page_id`. Prefer an accessible role and name, then label, placeholder, or test ID. Ask `browser_generate_locator` only when the snapshot does not give a durable contract locator.
2. A CSS locator is acceptable only after verifying it resolves exactly one target. Do not use unverified XPath/CSS, DOM order, or text that is known to be repeated.
3. Execute `browser_click`, `browser_hover`, `browser_drag`, `browser_type`, or `browser_press_key` against the same page ID. Use mouse coordinates only where the control genuinely has no accessible locator; record why and re-snapshot before a retry.
4. Verify an action with visible text, a state change, or `browser_verify_value`. A click, key press, or non-empty response alone is not proof of completion.

Do not use `browser_evaluate` to bypass strict locator behavior, inject a click, or access an element outside page-group authorization. See [locator and pointer limits](references/tool-contract.md) for the approved tool set and verification rule.
