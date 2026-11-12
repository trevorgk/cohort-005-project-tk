# Approving a Refund Request removes access but keeps the learner's progress

Learners can ask for a refund after starting a course, so approval must not wipe what they did. Approving deletes only the enrollment row (which is what grants access) and leaves lesson progress, ratings and watch history untouched. A learner who buys the course again resumes where they left off.

## Considered Options

- **Delete everything tied to the purchase.** Rejected: destroys the learner's work and the watch history the refund-eligibility check relies on.
- **Soft-revoke with a `revokedAt` on the enrollment.** Rejected: access checks read the enrollment row, so every check would need to learn about revocation; deleting the row keeps them unchanged.
- **Keep access until staff revoke it separately.** Rejected: a refunded learner would keep a course they no longer paid for.

## Consequences

Whether a learner was refunded lives on the refund row, not the enrollment. The enrollment's old `enrolledAt` is lost; a repurchase creates a new one.
