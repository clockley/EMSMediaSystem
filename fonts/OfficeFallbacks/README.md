# Office-compatible fallback fonts

This folder contains open-licensed metric-compatible fallback fonts used for
PPTX rendering when Microsoft Office fonts are not installed on the system.

Included families:

- Carlito (`Calibri`, `Calibri Light`, `Aptos`, `Aptos Display`)
- Caladea (`Cambria`, `Constantia`, `Cambria Math`)
- Arimo (`Arial`, `Verdana`, `Trebuchet MS`, `Candara`, `Corbel`)
- Selawik (`Segoe UI`, `Segoe UI Light`, `Segoe UI Semilight`, `Segoe UI Semibold`)
- Tinos (`Times New Roman`)
- Gelasio (`Georgia`)
- Cousine (`Courier New`, `Consolas`)
- Wine Tahoma (`Tahoma`)

The aliases are defined in `src/main.css`, and `local(...)` is always tried
first so native installed fonts still win when available.
