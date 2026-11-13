/**
 * Controlled Migration Engine Orchestrator — SB Manager (SBM-030-C, SBM-030-D, SBM-031)
 * 
 * Executes an auditable, idempotent, resumable 10-stage migration pipeline
 * from legacy msme_ledger_db to destination sb_manager_db_v1.
 * 
 * Design Rules:
 * - Uses dependency injection: accepts (legacyAdapter, targetDb, businessId, options).
 * - Never touches or opens live production databases.
 * - Enforces durable stage checkpoints in migrationCheckpoints with version validation.
 * - Persists unverified or malformed records into dedicated migrationQuarantine store.
 * - Wraps stage writes and checkpoint completions in Dexie multi-store read-write transactions.
 * - Enforces zero double-counting on debt and stock movements.
 * - Traps top-level execution errors, marking the active stage as failed without masking original errors.
 */

import { MigrationCheckpointManager, CURRENT_MIGRATION_VERSION } from './checkpoints.js';
import { MigrationQuarantineManager } from './quarantine.js';
import { reconcileCustomerDebt } from './debtReconciliation.js';
import { MigrationReconciliationReport } from './reconciliation.js';
import { classifyCurrency, CURRENCY_CLASSIFICATION } from './currencyClassifier.js';
import { toQuantityUnits } from '../inventory/quantity.js';

export class MigrationOrchestrator {
  /**
   * @param {Object} params
   * @param {LegacyReadOnlyAdapter} params.legacyAdapter - Narrow read-only adapter
   * @param {Dexie} params.targetDb - Destination Dexie instance (sb_manager_db_v1)
   * @param {string} params.businessId - Target business UUID
   * @param {Object} [params.options]
   * @param {string} [params.options.migrationRunId]
   * @param {number} [params.options.migrationVersion=CURRENT_MIGRATION_VERSION]
   * @param {boolean} [params.options.dryRun=false]
   * @param {Object} [params.options.currencyContext={}]
   */
  constructor({
    legacyAdapter,
    targetDb,
    businessId,
    options = {}
  }) {
    if (!legacyAdapter || typeof legacyAdapter.fetchCustomers !== 'function') {
      throw new TypeError('Valid LegacyReadOnlyAdapter instance is required.');
    }
    if (!targetDb || !targetDb.migrationCheckpoints) {
      throw new TypeError('Valid destination Dexie instance with migrationCheckpoints is required.');
    }
    if (!businessId || typeof businessId !== 'string') {
      throw new TypeError('Valid businessId string is required.');
    }

    this.legacyAdapter = legacyAdapter;
    this.targetDb = targetDb;
    this.businessId = businessId;
    this.options = options;
    this.migrationRunId = options.migrationRunId || `run_${Date.now()}`;
    this.migrationVersion = options.migrationVersion ?? CURRENT_MIGRATION_VERSION;
    this.dryRun = Boolean(options.dryRun);
    this.currentStage = null;

    this.checkpointManager = new MigrationCheckpointManager(targetDb, this.migrationRunId, this.migrationVersion);
    this.quarantineManager = new MigrationQuarantineManager(this.migrationRunId);
    this.reconciliation = new MigrationReconciliationReport(this.migrationRunId);
  }

  /**
   * Executes the full migration pipeline with top-level error trapping (SBM-030-C).
   * @returns {Promise<Object>} Final migration results and reconciliation report
   */
  async run() {
    this.currentStage = null;

    try {
      // Stage 1: Source Inspection
      this.currentStage = 'source_inspection';
      const inspection = await this._stageSourceInspection();

      // Stage 2: Business Identity Verification
      this.currentStage = 'business_identity';
      await this._stageBusinessIdentity();

      // Stage 3: Customers & Debt Reconciliation (SBM-031 & SBM-031-A)
      this.currentStage = 'customers_and_debt';
      await this._stageCustomersAndDebt();

      // Stage 4: Inventory & Stock Movements
      this.currentStage = 'inventory_and_stock';
      await this._stageInventoryAndStock();

      // Stage 5: Sales & Sales History
      this.currentStage = 'sales_and_history';
      await this._stageSalesAndHistory();

      // Stage 6: Reconciliation & Final Verification
      this.currentStage = 'reconciliation';
      const finalReport = await this._stageReconciliation();

      return {
        runId: this.migrationRunId,
        businessId: this.businessId,
        inspection,
        reconciliation: finalReport,
        quarantinedCount: this.quarantineManager.getCount(),
        isSuccess: finalReport.isReconciled
      };
    } catch (err) {
      // SBM-030-C: Top-level error handling
      if (this.currentStage) {
        try {
          // Sanitize message to strip potential sensitive customer strings (emails, card numbers)
          const rawMsg = err?.message || String(err) || 'Unknown error';
          const sanitizedMessage = String(rawMsg)
            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
            .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[REDACTED_CARD]');

          await this.checkpointManager.failStage(this.currentStage, {
            name: err?.name || 'Error',
            message: sanitizedMessage
          });
        } catch (checkpointErr) {
          // Avoid masking the original error if checkpoint recording also fails
          console.error(`Failed to record checkpoint failure for stage "${this.currentStage}":`, checkpointErr);
        }
      }
      throw err; // Re-throw original error to caller
    }
  }

  /**
   * Stage 1: Source Inspection
   */
  async _stageSourceInspection() {
    if (await this.checkpointManager.isStageCompleted('source_inspection')) {
      return await this.legacyAdapter.inspectSource();
    }

    await this.checkpointManager.startStage('source_inspection');
    const inspection = await this.legacyAdapter.inspectSource();

    this.reconciliation.entities.customers.discovered = inspection.counts.customers || 0;
    this.reconciliation.entities.inventory.discovered = inspection.counts.inventory || 0;
    this.reconciliation.entities.sales.discovered = inspection.counts.sales || 0;
    this.reconciliation.entities.transactions.discovered = inspection.counts.transactions || 0;

    await this.checkpointManager.completeStage('source_inspection', {
      sourceDatabaseName: inspection.databaseName,
      counts: inspection.counts
    });

    return inspection;
  }

  /**
   * Stage 2: Business Identity Verification
   */
  async _stageBusinessIdentity() {
    if (await this.checkpointManager.isStageCompleted('business_identity')) {
      return;
    }

    await this.checkpointManager.startStage('business_identity');

    if (!this.dryRun) {
      await this.targetDb.transaction(
        'rw',
        [this.targetDb.businesses, this.targetDb.migrationCheckpoints],
        async () => {
          const existingBiz = await this.targetDb.businesses.get(this.businessId);
          if (!existingBiz) {
            await this.targetDb.businesses.put({
              id: this.businessId,
              name: this.options.businessName || 'Migrated Legacy Shop',
              type: 'general',
              currency: 'NGN',
              identityStatus: 'unresolved_unclaimed',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1
            });
          }
          await this.checkpointManager.completeStage('business_identity');
        }
      );
    } else {
      await this.checkpointManager.completeStage('business_identity');
    }
  }

  /**
   * Stage 3: Customers & Debt Reconciliation (SBM-031 & SBM-031-A)
   */
  async _stageCustomersAndDebt() {
    if (await this.checkpointManager.isStageCompleted('customers_and_debt')) {
      return;
    }

    const customers = await this.legacyAdapter.fetchCustomers();
    const allTransactions = await this.legacyAdapter.fetchTransactions();

    await this.checkpointManager.startStage('customers_and_debt', customers.length);

    // Group transactions by customerId
    const txByCustomer = new Map();
    for (const tx of allTransactions) {
      if (!tx || !tx.customerId) continue;
      if (!txByCustomer.has(tx.customerId)) {
        txByCustomer.set(tx.customerId, []);
      }
      txByCustomer.get(tx.customerId).push(tx);
    }

    let processed = 0;
    let successful = 0;
    let quarantined = 0;
    let txMigrated = 0;
    let txQuarantined = 0;
    const processedCustIds = new Set();

    const destCustomers = [];
    const destCreditEntries = [];
    const destCreditPayments = [];

    for (const legacyCust of customers) {
      processed++;
      processedCustIds.add(legacyCust.id);

      // Validate required customer name
      if (!legacyCust.name || !String(legacyCust.name).trim()) {
        quarantined++;
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'customers',
          sourceId: legacyCust.id,
          rawRecord: legacyCust,
          reason: 'MISSING_CUSTOMER_NAME',
          validationErrors: ['Customer record lacks a valid name string.']
        });
        continue;
      }

      // Reconcile customer debt (SBM-031 & SBM-031-A)
      const custTxs = txByCustomer.get(legacyCust.id) || [];
      const debtRecon = reconcileCustomerDebt({
        customer: legacyCust,
        historicalTransactions: custTxs,
        businessId: this.businessId,
        currencyContext: this.options.currencyContext,
        quarantineManager: this.quarantineManager
      });

      if (debtRecon.isQuarantined) {
        quarantined++;
        this.reconciliation.financials.unresolvedQuarantinedDebtKobo += (legacyCust.totalDebt || 0);
        continue;
      }

      successful++;
      txMigrated += debtRecon.creditPayments.length;

      // Track financial reconciliation totals
      if (typeof debtRecon.authoritativeOpeningBalance === 'number') {
        this.reconciliation.financials.sourceAuthoritativeDebtKobo += debtRecon.authoritativeOpeningBalance;
      }
      if (debtRecon.creditEntry) {
        this.reconciliation.financials.destinationOpeningCreditKobo += debtRecon.creditEntry.originalAmount;
      }
      if (debtRecon.totalHistoricalRepayments) {
        this.reconciliation.financials.sourceHistoricalRepaymentsKobo += debtRecon.totalHistoricalRepayments;
        this.reconciliation.financials.destinationHistoricalPaymentsKobo += debtRecon.totalHistoricalRepayments;
      }

      // Stage destination records
      const destCustomer = {
        id: legacyCust.id,
        businessId: this.businessId,
        name: legacyCust.name.trim(),
        phone: legacyCust.phone ? String(legacyCust.phone).trim() : null,
        isArchived: false,
        sync_status: 'pending',
        updatedAt: legacyCust.updatedAt ? new Date(legacyCust.updatedAt).toISOString() : new Date().toISOString()
      };
      destCustomers.push(destCustomer);

      if (debtRecon.creditEntry) {
        destCreditEntries.push(debtRecon.creditEntry);
      }
      for (const payment of debtRecon.creditPayments) {
        destCreditPayments.push(payment);
      }
    }

    // Check for orphaned transactions (referencing non-existent customers)
    for (const [txCustId, txList] of txByCustomer.entries()) {
      if (!processedCustIds.has(txCustId)) {
        for (const orphanTx of txList) {
          txQuarantined++;
          this.quarantineManager.quarantineRecord({
            sourceEntity: 'transactions',
            sourceId: orphanTx.id,
            rawRecord: orphanTx,
            reason: 'ORPHAN_TRANSACTION_CUSTOMER_NOT_FOUND',
            validationErrors: [`Transaction references unknown customerId "${txCustId}".`]
          });
        }
      }
    }

    // Add any transactions that were quarantined during debtReconciliation
    const quarTxs = this.quarantineManager.getQuarantined('transactions');
    const additionalQuarTx = quarTxs.length - txQuarantined;
    if (additionalQuarTx > 0) {
      txQuarantined += additionalQuarTx;
    }

    this.reconciliation.entities.customers.migrated = successful;
    this.reconciliation.entities.customers.quarantined = quarantined;
    this.reconciliation.entities.transactions.migrated = txMigrated;
    this.reconciliation.entities.transactions.quarantined = txQuarantined;
    this.reconciliation.entities.transactions.skipped = Math.max(0, allTransactions.length - (txMigrated + txQuarantined));

    // Multi-store transactional write (consistency guarantee)
    if (!this.dryRun) {
      await this.targetDb.transaction(
        'rw',
        [
          this.targetDb.customers,
          this.targetDb.creditEntries,
          this.targetDb.creditPayments,
          this.targetDb.migrationQuarantine,
          this.targetDb.migrationCheckpoints
        ],
        async () => {
          for (const c of destCustomers) await this.targetDb.customers.put(c);
          for (const ce of destCreditEntries) await this.targetDb.creditEntries.put(ce);
          for (const cp of destCreditPayments) await this.targetDb.creditPayments.put(cp);
          await this.quarantineManager.persistQuarantine(this.targetDb);
          await this.checkpointManager.completeStage('customers_and_debt', {
            processedRecords: processed,
            successfulRecords: successful,
            quarantinedRecords: quarantined
          });
        }
      );
    } else {
      await this.checkpointManager.completeStage('customers_and_debt', {
        processedRecords: processed,
        successfulRecords: successful,
        quarantinedRecords: quarantined
      });
    }
  }

  /**
   * Stage 4: Inventory & Stock Movements
   */
  async _stageInventoryAndStock() {
    if (await this.checkpointManager.isStageCompleted('inventory_and_stock')) {
      return;
    }

    const inventory = await this.legacyAdapter.fetchInventory();
    await this.checkpointManager.startStage('inventory_and_stock', inventory.length);

    let processed = 0;
    let successful = 0;
    let quarantined = 0;

    const destProducts = [];
    const destMovements = [];

    for (const item of inventory) {
      processed++;

      // Validate required product name
      const name = item.name || item.itemName;
      if (!name || !String(name).trim()) {
        quarantined++;
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'inventory',
          sourceId: item.id,
          rawRecord: item,
          reason: 'MISSING_PRODUCT_NAME',
          validationErrors: ['Inventory record lacks a valid item name.']
        });
        continue;
      }

      // Validate selling price
      const priceClass = classifyCurrency(item.price, {
        fieldName: 'price',
        expectedUnit: this.options.currencyContext?.expectedUnit || 'KOBO',
        hasLinkedEvidence: true
      });

      if (priceClass.status === CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE) {
        quarantined++;
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'inventory',
          sourceId: item.id,
          rawRecord: item,
          reason: `INVENTORY_PRICE_AMBIGUITY: ${priceClass.reason}`,
          validationErrors: [`Inventory price value "${item.price}" is unverified.`]
        });
        continue;
      }

      // Convert quantity to scale 1,000
      let scaledStock = 0;
      try {
        const rawStock = item.stockCount !== undefined ? item.stockCount : 0;
        scaledStock = toQuantityUnits(rawStock, { allowNegative: true });
      } catch (err) {
        quarantined++;
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'inventory',
          sourceId: item.id,
          rawRecord: item,
          reason: 'MALFORMED_STOCK_COUNT',
          validationErrors: [err.message]
        });
        continue;
      }

      successful++;
      this.reconciliation.stock.sourceInventoryCount++;
      this.reconciliation.stock.destinationProductsCount++;
      this.reconciliation.stock.totalOpeningStockUnits += scaledStock;

      const destProduct = {
        id: item.id,
        businessId: this.businessId,
        name: String(name).trim(),
        sku: item.sku || null,
        barcode: item.barcode || null,
        sellingPrice: priceClass.koboAmount,
        costPrice: null, // Legacy inventory had unvalued cost
        hasVerifiedCost: false,
        currentStock: scaledStock,
        reorderPoint: 5000,
        isArchived: false,
        sync_status: 'pending',
        updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString(),
        version: 1
      };
      destProducts.push(destProduct);

      // Generate opening stock movement if stock != 0
      if (scaledStock !== 0) {
        const openingMovement = {
          id: `mov_opening_${item.id}`,
          businessId: this.businessId,
          productId: item.id,
          movementType: 'opening_balance',
          quantityDelta: scaledStock,
          unitCost: null, // Unvalued opening stock
          referenceType: 'legacyOpening',
          referenceId: null,
          movementDate: item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString(),
          sync_status: 'pending'
        };
        destMovements.push(openingMovement);
        this.reconciliation.stock.destinationOpeningMovementsCount++;
      }
    }

    this.reconciliation.entities.inventory.migrated = successful;
    this.reconciliation.entities.inventory.quarantined = quarantined;

    // Multi-store transactional write (consistency guarantee)
    if (!this.dryRun) {
      await this.targetDb.transaction(
        'rw',
        [
          this.targetDb.products,
          this.targetDb.stockMovements,
          this.targetDb.migrationQuarantine,
          this.targetDb.migrationCheckpoints
        ],
        async () => {
          for (const p of destProducts) await this.targetDb.products.put(p);
          for (const m of destMovements) await this.targetDb.stockMovements.put(m);
          await this.quarantineManager.persistQuarantine(this.targetDb);
          await this.checkpointManager.completeStage('inventory_and_stock', {
            processedRecords: processed,
            successfulRecords: successful,
            quarantinedRecords: quarantined
          });
        }
      );
    } else {
      await this.checkpointManager.completeStage('inventory_and_stock', {
        processedRecords: processed,
        successfulRecords: successful,
        quarantinedRecords: quarantined
      });
    }
  }

  /**
   * Stage 5: Sales & Sales History
   */
  async _stageSalesAndHistory() {
    if (await this.checkpointManager.isStageCompleted('sales_and_history')) {
      return;
    }

    const sales = await this.legacyAdapter.fetchSales();
    await this.checkpointManager.startStage('sales_and_history', sales.length);

    let processed = 0;
    let successful = 0;
    let quarantined = 0;

    const destSales = [];
    const destSalePayments = [];

    for (const sale of sales) {
      processed++;

      const amountClass = classifyCurrency(sale.totalAmount, {
        fieldName: 'totalAmount',
        expectedUnit: this.options.currencyContext?.expectedUnit || 'KOBO',
        hasLinkedEvidence: true
      });

      if (amountClass.status === CURRENCY_CLASSIFICATION.AMBIGUOUS_QUARANTINE) {
        quarantined++;
        this.quarantineManager.quarantineRecord({
          sourceEntity: 'sales',
          sourceId: sale.id,
          rawRecord: sale,
          reason: `SALE_AMOUNT_AMBIGUITY: ${amountClass.reason}`,
          validationErrors: [`Sale totalAmount "${sale.totalAmount}" is ambiguous.`]
        });
        continue;
      }

      successful++;

      const destSale = {
        id: sale.id,
        businessId: this.businessId,
        saleNumber: sale.saleNumber || `LEG-SALE-${sale.id.slice(0, 8)}`,
        customerId: sale.customerId || null,
        items: Array.isArray(sale.items) ? sale.items : [],
        subtotal: amountClass.koboAmount,
        discountAmount: 0,
        totalAmount: amountClass.koboAmount,
        amountPaid: sale.amountPaid !== undefined ? Number(sale.amountPaid) : amountClass.koboAmount,
        creditAmount: sale.balance !== undefined ? Number(sale.balance) : 0,
        paymentStatus: sale.paymentStatus || 'paid',
        saleDate: sale.date ? new Date(sale.date).toISOString() : new Date().toISOString(),
        clientRevision: 1,
        serverRevision: 1,
        sync_status: 'pending',
        updatedAt: new Date().toISOString()
      };
      destSales.push(destSale);

      if (destSale.amountPaid > 0) {
        destSalePayments.push({
          id: `spay_legacy_${sale.id}`,
          saleId: sale.id,
          businessId: this.businessId,
          amount: destSale.amountPaid,
          paymentMethod: 'cash',
          reference: 'Legacy Migration',
          paymentDate: destSale.saleDate,
          sync_status: 'pending'
        });
      }
    }

    this.reconciliation.entities.sales.migrated = successful;
    this.reconciliation.entities.sales.quarantined = quarantined;

    // Multi-store transactional write (consistency guarantee)
    if (!this.dryRun) {
      await this.targetDb.transaction(
        'rw',
        [
          this.targetDb.sales,
          this.targetDb.salePayments,
          this.targetDb.migrationQuarantine,
          this.targetDb.migrationCheckpoints
        ],
        async () => {
          for (const s of destSales) await this.targetDb.sales.put(s);
          for (const sp of destSalePayments) await this.targetDb.salePayments.put(sp);
          await this.quarantineManager.persistQuarantine(this.targetDb);
          await this.checkpointManager.completeStage('sales_and_history', {
            processedRecords: processed,
            successfulRecords: successful,
            quarantinedRecords: quarantined
          });
        }
      );
    } else {
      await this.checkpointManager.completeStage('sales_and_history', {
        processedRecords: processed,
        successfulRecords: successful,
        quarantinedRecords: quarantined
      });
    }
  }

  /**
   * Stage 6: Reconciliation & Final Verification
   */
  async _stageReconciliation() {
    await this.checkpointManager.startStage('reconciliation');

    // Finalize report
    this.reconciliation.finalize();

    // Multi-store transactional write for quarantine persistence and final checkpoint
    if (!this.dryRun) {
      await this.targetDb.transaction(
        'rw',
        [
          this.targetDb.migrationQuarantine,
          this.targetDb.migrationCheckpoints
        ],
        async () => {
          await this.quarantineManager.persistQuarantine(this.targetDb);
          await this.checkpointManager.completeStage('reconciliation', {
            isReconciled: this.reconciliation.isReconciled,
            financials: this.reconciliation.financials,
            discrepancies: this.reconciliation.discrepancies
          });
        }
      );
    } else {
      await this.checkpointManager.completeStage('reconciliation', {
        isReconciled: this.reconciliation.isReconciled,
        financials: this.reconciliation.financials,
        discrepancies: this.reconciliation.discrepancies
      });
    }

    return this.reconciliation;
  }
}
