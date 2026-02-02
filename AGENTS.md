# AGENTS.md

## Project goal
Build a WoW TBC checklist web app:
- Step-by-step tasks with prerequisites (rep, dungeons, crafting, badges).
- Checkmarks; completed tasks hide/collapse.
- Later: Blizzard character snapshot + auto-complete.

## Guardrails
- No secrets committed to repo.
- Keep changes small and reviewable.
- TypeScript everywhere.
- After changes: run `npm run lint` and `npm run build`.

## Structure
- UI: `src/app`, `src/components`
- Logic: `src/lib`
- Data: `src/data`