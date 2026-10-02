# Form and dialog states

`browser_fill_form` reports `completed_fields` and `failed_field`; preserve
both on a partial failure. Use the specified field types for checkboxes, radio
groups, and comboboxes. Assert final state through the dedicated visible,
text, or value verification tools.

Arm a dialog through `browser_handle_dialog` before its trigger. Its terminal
status is `handled`, `expired`, or `failed`; no status is implied by the click
that was expected to trigger it.
