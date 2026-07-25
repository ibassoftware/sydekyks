import type { AccountsPayableBillFact } from '../../domain/schemas'

export const areDuplicateComparableDocuments = (
  left: AccountsPayableBillFact,
  right: AccountsPayableBillFact
): boolean => left.moveType === right.moveType
