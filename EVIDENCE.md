# Evidence

## One Claim

Experience Engine generates actionable coaching tutorials that a normal AI video summary cannot.

## What We Compare

- **Baseline:** Give an AI the raw video. Ask it to produce coaching advice.
- **Ours:** Give Experience Engine the same video. Generate a tutorial.
- Same clips, same task, blind review.

## Steps

- [ ] Pick 5 clips where two workers do the same task differently
- [ ] Generate baseline coaching output (raw AI summary of each clip)
- [ ] Generate Experience Engine tutorial (behavioral comparison + annotations)
- [ ] Put both side by side, unlabeled
- [ ] Have 2-3 reviewers score blindly

## Scoring (1-5)

- **Specificity:** Does it point to an exact moment and behavior?
- **Teachability:** Could a superintendent use this to coach someone in 5 minutes?
- **Root cause:** Does it explain _why_ the difference exists, not just _that_ it exists?

## We Win If

- Ours scores higher on teachability
- Ours identifies specific behaviors the baseline misses
- A reviewer says "I could show this to a worker right now"
