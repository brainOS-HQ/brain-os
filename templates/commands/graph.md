# Brain OS : Entity Graph

Show how entities connect, what they share, and where building one helps another.

## REQUIRED FIRST READ

Before any tool call, read `~/.claude/brain-os/PROTOCOL.md`.

## Input

Arguments: `$ARGUMENTS` (optional : an entity name for its connections, or "full" for the complete graph)

## Primary tool sequence

1. `mcp__brain-os__entity_read()` : all entities and their `related_entities` fields
2. `mcp__brain-os__pattern_detect()` : shared themes
3. `mcp__brain-os__semantic_recall(query, source_kind="decision")` : cross-entity decisions

## If entity name given : connections view

Read the named entity plus all entities it relates to.

```
========================================
  [ENTITY NAME] : CONNECTIONS
========================================

  DEPENDS ON
  ----------------------------------------
  [entity] : [what this entity needs from that one]

  FEEDS INTO
  ----------------------------------------
  [entity] : [what that entity gets from this one]

  SHARES WITH
  ----------------------------------------
  [entity] : [architecture, patterns, users, or theme]

  SHARED DECISIONS
  ----------------------------------------
  [decision that affects multiple connected entities]

========================================
  LEVERAGE INSIGHT
========================================
  [one sentence: if you work on X, it also advances Y because Z]
========================================
```

## If "full" or no argument : full graph

Display all entities grouped by strategic theme, showing connections.

```
================================================
  ENTITY GRAPH
================================================

  [THEME 1 : e.g. SHARED FOUNDATION]
  --------------------------------------------
  [entity A] -> [entity B] : [why]

  [THEME 2 : e.g. CONSUMER APPS]
  --------------------------------------------
  [entity C] <-> [entity D] : [shared concern]

  [PARKED / ARCHIVED]
  --------------------------------------------
  [names, comma-separated]

================================================

  HIGHEST LEVERAGE NODE
  --------------------------------------------
  [which entity, if advanced, creates the most
   downstream value across other entities?]

  SHARED ARCHITECTURE OPPORTUNITIES
  --------------------------------------------
  [what could be built once and reused?]

  CROSS-ENTITY DECISIONS PENDING
  --------------------------------------------
  [decisions that affect more than one entity]
================================================
```

Group entities by themes that emerge from the data. Do not assume fixed categories. If only one theme exists, show one group.

## Rules

- Connections must be real : shared users, code, decisions, blockers, or themes.
- Do not invent connections. "Both are apps" is not a connection.
- "Highest Leverage Node" answers: where should I invest for maximum impact?
- Reflect current entity modes.
- MCP tools only.
