/**
 * Legacy Debt Reconciliation Engine — SB Manager (SBM-031 & SBM-031-A)
 * 
 * Implements Blueprint V2.1 Section 1.1, 12, 16 debt reconciliation rules:
 * 1. Legacy `customer.totalDebt` is the AUTHORITATIVE opening balance at migration time.
 * 2. Historical repayments are preserved as unallocated legacy history (`creditPayments`).
 * 3. Historical repayments are NEVER deducted from `customer.totalDebt` a second time.
 * 4. Deterministic transaction deduplication: identical replays are safely skipped;
 *    conflicting duplicates sharing an ID are rejected and quarantined.
 * 5. Preserves 100% auditable traceability without double-counting.
 */

import { classifyCurrency, CURRENCY_CLASSIFICATION } from './currencyClassifier.js';

/**
 * Reconciles debt for a single legacy customer against historical transaction records.
 * 
 * @param {Object} params
 * @param {Object} params.customer - Raw legacy customer record
 * @param {Array<Object>} [params.historicalTransactions=[]] - Legacy transactions for this customer
 * @param {string} params.businessId - Target business UUID
 * @param {Object} [params.currencyContext={}] - Currency verification context
 * @param {Object} [params.quarantineManager] - Optional quarantine manager instance
 * @returns {Object} Reconciled debt data structure
 */
export function reconcileCustomerDebt({
  customer,
  historicalTransactions = [],
  businessId,
  currencyContext = {},
  quarantineManager = null
}) {
  if (!customer || !customer.id) {
    throw new TypeError('Valid legacy customer object with id is required.');
  }
  if (!businessId) {
    throw new TypeError('businessId is required for debt reconciliation.');
  }

  const notes = [];
  const customerId = customer.id;

  // 1. Authoritative Opening Balance Classification
  // In legacy MSME Ledger v2, customer.totalDebt was stored in integer Kobo (or 0)
  const classification = classifyCurrency(customer.totalDebt, {
    fieldName: 'totalDebt',
    expectedUnit: currencyContext.expectedUnit || 'KOBO',
    hasLinkedEvidence: currencyContext.hasLinkedEvidence ?? (historicalTransactions.length > 0)
  });

  // If debt is ambiguous or malformed, quarantine it and do not guess
  if (classification.status === CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE) {
    if (quarantineManager) {
      quarantineManager.quarantineRecord({
        sourceEntity: 'customers',
        sourceId: customerId,
        rawRecord: customer,
        reason: `DEBT_CURRENCY_AMBIGUITY: ${classification.reason}`,
        validationErrors: [`Legacy totalDebt value "${customer.totalDebt}" is ambiguous or malformed.`]
      });
    }

    return {
      customerId,
      businessId,
      authoritativeOpeningBalance: null,
      isQuarantined: true,
      creditEntry: null,
      creditPayments: [],
      reconciliationStatus: 'quarantined',
      notes: [`Customer debt quarantined: ${classification.reason}`]
    };
  }

  const authoritativeOpeningKobo = classification.koboAmount; // Integer Kobo

  // 2. Build Destination Opening Credit Entry
  // Only created if customer has non-zero debt
  let creditEntry = null;
  const creditEntryId = `credit_opening_${customerId}`;

  if (authoritativeOpeningKobo > 0) {
    creditEntry = {
      id: creditEntryId,
      businessId,
      customerId,
      saleId: null,
      entryType: 'legacy_opening_balance',
      originalAmount: authoritativeOpeningKobo,
      settledAmount: 0, // CRITICAL: Opening balance already reflects legacy repayments!
      adjustedAmount: 0,
      remainingBalance: authoritativeOpeningKobo,
      dueDate: null,
      status: 'open',
      sync_status: 'pending',
      updatedAt: customer.updatedAt ? new Date(customer.updatedAt).toISOString() : new Date().toISOString()
    };
  }

  // 3. Process Historical Repayments with Deterministic Conflict Validation (SBM-031-A)
  const seenTransactions = new Map();
  const creditPayments = [];
  let totalHistoricalRepayments = 0;

  for (const tx of historicalTransactions) {
    // 3.1 Validate missing or malformed ID
    if (!tx || !tx.id || typeof tx.id !== 'string') {
      const fallbackId = `malformed_tx_${customerId}_${seenTransactions.size + 1}`;
      if (quarantineManager) {
        quarantineManager.quarantineRecord({
          sourceEntity: 'transactions',
          sourceId: fallbackId,
          rawRecord: tx || {},
          reason: 'MALFORMED_TRANSACTION_MISSING_ID',
          validationErrors: ['Transaction record missing valid string id.']
        });
      }
      notes.push(`Encountered malformed transaction with missing or invalid id.`);
      continue;
    }

    // 3.2 Check for duplicate IDs and validate conflicts
    if (seenTransactions.has(tx.id)) {
      const existingTx = seenTransactions.get(tx.id);

      const isIdentical = (
        String(existingTx.customerId || '') === String(tx.customerId || '') &&
        String(existingTx.type || '').toUpperCase() === String(tx.type || '').toUpperCase() &&
        Number(existingTx.amount) === Number(tx.amount) &&
        String(existingTx.date || '') === String(tx.date || '') &&
        String(existingTx.paymentMethod || '') === String(tx.paymentMethod || '')
      );

      if (!isIdentical) {
        const conflictMsg = `Conflicting duplicate transaction detected for ID "${tx.id}": fields diverge (existing amount=${existingTx.amount}, type=${existingTx.type}; incoming amount=${tx.amount}, type=${tx.type}).`;
        if (quarantineManager) {
          quarantineManager.quarantineRecord({
            sourceEntity: 'transactions',
            sourceId: tx.id,
            rawRecord: tx,
            reason: 'CONFLICTING_DUPLICATE_TRANSACTION',
            validationErrors: [conflictMsg]
          });
        }
        notes.push(conflictMsg);
        continue;
      }

      // Identical duplicate replay: safely skip to prevent double counting
      notes.push(`Identical duplicate transaction replay skipped: "${tx.id}".`);
      continue;
    }

    seenTransactions.set(tx.id, tx);

    // 3.3 Only process repayment/payment transaction types
    const txType = String(tx.type || '').toUpperCase();
    if (txType !== 'PAYMENT' && txType !== 'DEBT_PAYMENT' && txType !== 'REPAYMENT') {
      continue;
    }

    // 3.4 Classify transaction amount currency
    const txClass = classifyCurrency(tx.amount, {
      fieldName: 'amount',
      expectedUnit: currencyContext.expectedUnit || 'KOBO',
      hasLinkedEvidence: true
    });

    if (txClass.status === CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE) {
      if (quarantineManager) {
        quarantineManager.quarantineRecord({
          sourceEntity: 'transactions',
          sourceId: tx.id,
          rawRecord: tx,
          reason: `TRANSACTION_AMOUNT_AMBIGUITY: ${txClass.reason}`,
          validationErrors: [`Legacy transaction amount "${tx.amount}" is unverified.`]
        });
      }
      notes.push(`Quarantined transaction ${tx.id} due to ${txClass.reason}`);
      continue;
    }

    const paymentKobo = txClass.koboAmount;
    totalHistoricalRepayments += paymentKobo;

    // Preserved as UNALLOCATED legacy historical payment
    // It is NOT deducted from opening creditEntry
    creditPayments.push({
      id: `cpay_legacy_${tx.id}`,
      creditEntryId: null, // Preserved unlinked to avoid double deduction
      customerId,
      businessId,
      amount: paymentKobo,
      paymentMethod: tx.paymentMethod || 'other',
      allocationStatus: 'unallocated_legacy_historical',
      paymentDate: tx.date ? new Date(tx.date).toISOString() : new Date().toISOString(),
      sync_status: 'pending'
    });
  }

  // 4. Discrepancy Analysis (Historical Repayments vs. Opening Balance)
  if (totalHistoricalRepayments > 0) {
    notes.push(
      `Preserved ${creditPayments.length} historical repayments totaling ${totalHistoricalRepayments} Kobo as unallocated history.`
    );
    if (totalHistoricalRepayments > authoritativeOpeningKobo && authoritativeOpeningKobo > 0) {
      notes.push(
        `Historical repayment sum (${totalHistoricalRepayments} Kobo) exceeds opening debt balance (${authoritativeOpeningKobo} Kobo). Authoritative balance preserved.`
      );
    }
  }

  return {
    customerId,
    businessId,
    authoritativeOpeningBalance: authoritativeOpeningKobo,
    isQuarantined: false,
    creditEntry,
    creditPayments,
    totalHistoricalRepayments,
    reconciliationStatus: authoritativeOpeningKobo > 0 ? 'reconciled' : 'zero_debt',
    notes
  };
}
