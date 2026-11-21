# 2026-11-21: T2: slots and shapes

- **Rank.** A story's place by weight among all of the week's stories. Ties go to cumulative sources, then to key.
- **Packages.**
  - The four heaviest stories in the covered categories take the lead and packages 2 to 4. The covered categories (bible f) are politics, conflict, world, general, economy, science, health and environment.
  - The fifth runs as package 5 only when it clears the cap or names its primary sources in rundown-edit.json (bible l: "qualifies as a document package"). Otherwise it opens the briefs.
- **Shape by the cap.** Bible l says "a rank with under 30 s of cleared moving picture airs as a document package at its rank". This applies to every package slot, the lead included.
  - Section b's table states document lengths only for packages 3 and 4. It is read as the expected case, not a limit, since section l allows no demotion.
  - When the lead or package 2 falls under the cap, it is a document package, and the rundown's `notes` says so.
- **Briefs.**
  - The next covered stories take the briefs, up to 10 (bible b and f allow 6 to 10; the screenplay drops from the end).
  - One story outside the covered categories holds the final brief if its rank is in the top five (bible f).
  - Every other story goes in `not_covered` with its reason, for the sources page.
- **COI (bible m).** Set when the story's parties, its entities or any of its cluster titles name a `coi_entities` entry as a whole word. That flags a filing before its parties are written. `coi_match` names what matched.
- **Tease.** Defaults to the lead and packages 2 to 4, in rank order.
