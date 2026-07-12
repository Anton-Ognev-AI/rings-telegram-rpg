# Claude Code Project Protocol

## Sequence of Operations
1. Read PROJECT_STATE.md to understand the current architecture.
2. Read TASKS.md to identify the active task.
3. Check DECISIONS.md for constraints.
4. Execute work within the scope of ONE task.

## Constraints
- DO NOT refactor code outside the active task.
- DO NOT touch files marked as `locked` in PROJECT_STATE.md.
- ALWAYS update PROJECT_STATE.md and TASKS.md before ending the session.
- Use skills from `/skills` if available.

## Status Definitions
- `todo`: Backlog items.
- `in_progress`: Current active task.
- `approved`: Implemented and verified.
- `locked`: Core logic, do not modify without explicit 'Unlock' command.
