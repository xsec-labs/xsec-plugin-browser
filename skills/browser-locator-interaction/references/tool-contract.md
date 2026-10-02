# Locator and pointer controls

The interaction set is `browser_snapshot`, `browser_generate_locator`,
`browser_click`, `browser_hover`, `browser_drag`, `browser_type`,
`browser_press_key`, pointer tools, and `browser_resize`. Role/name, label,
placeholder, and test ID are preferred. Strict resolution requires one target.

Coordinate input is limited to controls with no usable accessible locator. A
coordinate replay must include the prior snapshot and reason. `browser_evaluate`
may not be used to replace strict locator operations.
