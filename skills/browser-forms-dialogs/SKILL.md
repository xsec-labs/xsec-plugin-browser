---
name: browser-forms-dialogs
description: Fill structured forms, arm dialogs, and verify control values through the browser MCP server.
---

# Browser Forms and Dialogs

Use this Skill for structured forms, dialog handling, and explicit UI assertions. Review the snapshot and control type first; do not treat arbitrary text entry as a universal form primitive.

1. Identify controls and construct `browser_fill_form` entries with the contract's `locator`, `type`, and `value` forms. Preserve intended field order, particularly when later options depend on earlier fields.
2. Use the prescribed value type for checkbox, radio, and combobox controls. Empty strings, absent values, and a successful transport response are not proof that the page accepted a value.
3. If the form stops, inspect `completed_fields` and `failed_field`. Continue only from the reported unfinished field after correcting the cause; do not resubmit fields that have already completed.
4. Before any action expected to raise an alert, confirm, prompt, or before-unload dialog, arm `browser_handle_dialog`. Trigger the action, then call `browser_dialog_status` and distinguish `handled`, `expired`, and `failed`.
5. Verify the resulting UI with `browser_verify_element_visible`, `browser_verify_text_visible`, or `browser_verify_value`.

Do not bypass validation or confirmation with page JavaScript. A dialog can be armed before its trigger but cannot be assumed to have appeared. Read [form and dialog detail](references/tool-contract.md) for the state transition and failure evidence to retain.
