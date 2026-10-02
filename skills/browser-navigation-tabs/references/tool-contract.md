# Navigation and tabs

Use `browser_navigate`, `browser_navigate_back`, `browser_tabs`,
`browser_wait_for`, and `browser_close`. The session and stable page IDs come
from the MCP result, never a DOM position. Hosted URL approval is a separate
Host decision; only HTTP(S) URLs with a host are candidates.

`follow_new_tab` changes which page is selected only after the bridge observes
the new page. Re-read `browser_tabs` after a popup or close. A wait condition
must name page state, text, or a locator; an elapsed sleep is not verification.
