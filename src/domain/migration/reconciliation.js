/**
 * Migration Reconciliation Engine — SB Manager
 * 
 * Verifies end-to-end data integrity between legacy source and destination.
 * Compares source and destination counts, financial balances, and quarantined items.
 */

export class MigrationReconciliationReport {
  constructor(migrationRunId) {
    this.migrationRunId = migrationRunId;
    this.generatedAt = new Date().toISOString();
    this.entities = {
      customers: { discovered: 0, migrated: 0, quarantined: 0, skipped: 0, failed: 0 },
      inventory: { discovered: 0, migrated: 0, quarantined: 0, skipped: 0, failed: 0 },
      sales: { discovered: 0, migrated: 0, quarantined: 0, skipped: 0, failed: 0 },
      transactions: { discovered: 0, migrated: 0, quarantined: 0, skipped: 0, failed: 0 }
    };
    this.financials = {
      sourceAuthoritativeDebtKobo: 0,
      destinationOpeningCreditKobo: 0,
      sourceHistoricalRepaymentsKobo: 0,
      destinationHistoricalPaymentsKobo: 0,
      unresolvedQuarantinedDebtKobo: 0,
      debtVarianceKobo: 0
    };
    this.stock = {
      sourceInventoryCount: 0,
      destinationProductsCount: 0,
      destinationOpeningMovementsCount: 0,
      totalOpeningStockUnits: 0
    };
    this.unresolvedReferences = [];
    this.discrepancies = [];
    this.isReconciled = false;
  }

  /**
   * Finalizes reconciliation calculation and verifies zero-variance constraints.
   */
  finalize() {
    this.financials.debtVarianceKobo = 
      this.financials.sourceAuthoritativeDebtKobo - this.financials.destinationOpeningCreditKobo;

    // Check reconciliation validity:
    // 1. Debt variance must be exactly 0 (excluding quarantined items)
    // 2. All discovered items must equal migrated + quarantined + skipped
    let allEntitiesBalanced = true;
    for (const [entity, counts] of Object.entries(this.entities)) {
      const accountedFor = counts.migrated + counts.quarantined + counts.skipped;
      if (counts.discovered !== accountedFor) {
        allEntitiesBalanced = false;
        this.discrepancies.push(
          `Entity "${entity}" count mismatch: discovered ${counts.discovered} != accounted for ${accountedFor}`
        );
      }
    }

    this.isReconciled = (
      allEntitiesBalanced && 
      this.financials.debtVarianceKobo === 0 &&
      this.discrepancies.length === 0
    );

    return this;
  }
}

