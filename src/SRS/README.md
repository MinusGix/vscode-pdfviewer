The SRS (space repetition system) helps add cards/information to go over again in the future.  
These are categorized into user-defined categories and can be defined in any markdown file.  

Algorithm: This uses FSRS scheduling.

Review order
- Configure `lattice.cards.reviewOrder` to control how due cards are presented:
  - `random-daily-per-file` (default): deterministic daily shuffle per file to keep related topics together.
  - `random-daily-global`: deterministic daily shuffle across all due cards.
  - `dueTime`: order strictly by FSRS due time.
