# Brain OS : Entity Graph

Show how entities connect, what they share, and where building one helps another.

## Input

Arguments: `$ARGUMENTS` (optional : an entity name to show its connections, or "full" for the complete graph)

## How

Call `entity_read` to fetch entities and their `related_entities` fields. Use `pattern_detect` for shared themes and `decision_log` review for cross-entity decisions.

Do not read code, repos, or `CLAUDE.md` files.

## If entity name given: connections view

Read the named entity plus all entities it relates to.

```
========================================
  [ENTITY NAME] : CONNECTIONS
========================================

  DEPENDS ON
  ----------------------------------------
  [entity] : [why : what this entity needs from that one]

  FEEDS INTO
  ----------------------------------------
  [entity] : [why : what that entity gets from this one]

  SHARES WITH
  ----------------------------------------
  [entity] : [what they share : architecture, patterns, users, theme]

  SHARED DECISIONS
  ----------------------------------------
  [decision that affects multiple connected entities]

========================================
  LEVERAGE INSIGHT
========================================
  [one sentence: if you work on X, it also advances Y because Z]
========================================
```

## If "full" or no argument: full graph

Display all entities grouped by strategic theme, showing connections.

```
================================================
  ENTITY GRAPH
================================================

  [THEME 1 : e.g. SHARED FOUNDATION]
  --------------------------------------------
  [entity A] -- connects to -- [entity B] : [why]

  [THEME 2 : e.g. CONSUMER APPS]
  --------------------------------------------
  [entity C] <-> [entity D] : [shared concern]

  [THEME 3 : e.g. BUSINESS TOOLS]
  --------------------------------------------
  [entity E] <-> [entity F] : [shared concern]

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

Group entities by themes that emerge from the data : do not assume fixed categories. If only one theme exists, show one group.

## Rules

- Connections must be real : shared users, shared code, shared decisions, shared blockers, shared themes.
- Do not invent connections. "Both are apps" is not a connection.
- The "Highest Leverage Node" section answers: where should I invest for maximum impact?
- Reflect current entity modes. If something was parked, show it as parked.
- Do not read code. MCP tools only.
