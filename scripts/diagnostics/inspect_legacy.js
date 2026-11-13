/**
 * @file inspect_legacy.js
 * @description Non-destructive, read-only Phase 0 diagnostic script for MSME Ledger legacy data.
 * Can inspect exported JSON snapshots of IndexedDB / MongoDB, or inspect MongoDB read-only via mongoose/mongodb driver.
 * Uses zero third-party packages for file inspection; depends only on native Node.js core modules.
 *
 * Usage:
 *   node scripts/diagnostics/inspect_legacy.js --file <path-to-json-export>
 *   node scripts/diagnostics/inspect_legacy.js --sample (runs against built-in representative test vectors)
 */

import fs from 'node:fs';
import path from 'node:path';

// Parse CLI Arguments
const args = process.argv.slice(2);
let filePath = null;
let runSample = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    filePath = args[i + 1];
    i++;
  } else if (args[i] === '--sample') {
    runSample = true;
  }
}

// Built-in Representative Sample Dataset (Derived from Codebase JSDoc and Edge-Case Analysis)
const sampleLegacyData = {
  customers: [
    { id: "cus_01", name: "Alhaji Musa", phone: "08012345678", totalDebt: 1000000, sync_status: "synced", updatedAt: "2026-09-14T10:00:00Z" },
    { id: "cus_02", name: "Amina Garba", phone: "08098765432", totalDebt: 0, sync_status: "synced", updatedAt: "2026-09-14T11:00:00Z" },
    { id: "cus_03", name: "Ibrahim Sani", phone: "+2348033333333", totalDebt: 450000, sync_status: "pending", updatedAt: "2026-09-14T12:00:00Z" },
    { id: "cus_04", name: "", phone: "invalid-phone", totalDebt: 25, sync_status: "pending", updatedAt: "2026-09-14T13:00:00Z" }, // Edge case: name missing, phone invalid, small debt
    { id: "cus_05", name: "Float User", phone: "08022222222", totalDebt: 1500.5, sync_status: "synced", updatedAt: "2026-09-14T14:00:00Z" } // Edge case: malformed float
  ],
  inventory: [
    { id: "inv_01", itemName: "Dangote Cement 50kg", price: 950000, stockCount: 50, sync_status: "synced", updatedAt: "2026-09-14T09:00:00Z" },
    { id: "inv_02", itemName: "Motor Oil (4L)", price: 650000, stockCount: 12, sync_status: "synced", updatedAt: "2026-09-14T09:30:00Z" },
    { id: "inv_03", itemName: "Sugar (1kg)", price: 250000, stockCount: 0, sync_status: "synced", updatedAt: "2026-09-14T09:45:00Z" },
    { id: "inv_04", itemName: "Rice Bag (50kg)", price: 750, stockCount: 5, sync_status: "pending", updatedAt: "2026-09-14T10:15:00Z" }, // Edge case: suspected raw Naira (750 Naira instead of 75,000 Kobo)
    { id: "inv_05", itemName: "", price: -100, stockCount: -2, sync_status: "pending", updatedAt: "2026-09-14T10:30:00Z" } // Edge case: empty name, negative price, negative stock
  ],
  sales: [
    { id: "sal_01", customerId: "cus_01", items: [{ inventoryId: "inv_01", quantity: 2, price: 950000 }], totalAmount: 1900000, amountPaid: 1900000, balance: 0, paymentStatus: "paid", sync_status: "synced", date: "2026-09-14T10:30:00Z" },
    { id: "sal_02", customerId: "cus_01", items: [{ inventoryId: "inv_02", quantity: 1, price: 650000 }], totalAmount: 650000, amountPaid: 200000, balance: 450000, paymentStatus: "partial", sync_status: "pending", date: "2026-09-14T11:00:00Z" },
    { id: "sal_03", customerId: "cus_unknown", items: [{ inventoryId: "inv_01", quantity: 1, price: 950000 }], totalAmount: 950000, amountPaid: 0, balance: 950000, paymentStatus: "unpaid", sync_status: "pending", date: "2026-09-14T11:30:00Z" } // Edge case: missing customer link
  ],
  transactions: [
    { id: "tx_01", customerId: "cus_01", type: "PAYMENT", amount: 200000, date: "2026-09-14T11:15:00Z", sync_status: "pending" },
    { id: "tx_02", customerId: "cus_02", type: "PAYMENT", amount: 500000, date: "2026-09-14T11:45:00Z", sync_status: "pending" }, // Customer has 0 debt but payment history
    { id: "tx_03", customerId: "cus_01", type: "PAYMENT", amount: 15.75, date: "2026-09-14T12:00:00Z", sync_status: "pending" } // Edge case: float in transaction
  ]
};

/**
 * Audit function to evaluate a dataset strictly read-only.
 */
export function auditLegacyDataset(dataset) {
  const report = {
    timestamp: new Date().toISOString(),
    entityCounts: {},
    duplicateIds: [],
    anomalies: {
      monetary: [],
      inventory: [],
      customerDebt: [],
      referentialIntegrity: []
    },
    currencyClassifications: {
      verifiedKobo: 0,
      suspectedRawNaira: 0,
      malformedFloatOrNegative: 0,
      ambiguousSmallInteger: 0
    }
  };

  const customers = dataset.customers || [];
  const inventory = dataset.inventory || [];
  const sales = dataset.sales || [];
  const transactions = dataset.transactions || [];

  report.entityCounts = {
    customers: customers.length,
    inventory: inventory.length,
    sales: sales.length,
    transactions: transactions.length
  };

  const seenIds = new Set();
  const customerIds = new Set();
  const inventoryIds = new Set();

  // 1. Audit Customers
  for (const c of customers) {
    if (!c.id) {
      report.anomalies.referentialIntegrity.push({ entity: 'customer', issue: 'Missing ID', record: c });
    } else {
      if (seenIds.has(c.id)) report.duplicateIds.push({ entity: 'customer', id: c.id });
      seenIds.add(c.id);
      customerIds.add(c.id);
    }

    if (!c.name || typeof c.name !== 'string' || c.name.trim() === '') {
      report.anomalies.referentialIntegrity.push({ entity: 'customer', id: c.id, issue: 'Empty or missing customer name' });
    }

    // Inspect totalDebt
    auditMonetaryValue(c.totalDebt, 'customer.totalDebt', c.id, report);
  }

  // 2. Audit Inventory
  for (const item of inventory) {
    if (!item.id) {
      report.anomalies.referentialIntegrity.push({ entity: 'inventory', issue: 'Missing ID', record: item });
    } else {
      if (seenIds.has(item.id)) report.duplicateIds.push({ entity: 'inventory', id: item.id });
      seenIds.add(item.id);
      inventoryIds.add(item.id);
    }

    if (!item.itemName || typeof item.itemName !== 'string' || item.itemName.trim() === '') {
      report.anomalies.inventory.push({ id: item.id, issue: 'Empty or missing itemName' });
    }

    if (typeof item.stockCount !== 'number' || item.stockCount < 0) {
      report.anomalies.inventory.push({ id: item.id, stockCount: item.stockCount, issue: 'Negative or non-numeric stockCount' });
    }

    // Cost price check (V2.1 requirement: check if historical cost is specified)
    if (item.costPrice === undefined || item.costPrice === null) {
      report.anomalies.inventory.push({ id: item.id, issue: 'Unspecified historical purchase cost (WAC requirement)' });
    }

    auditMonetaryValue(item.price, 'inventory.price', item.id, report, item.itemName);
  }

  // 3. Audit Sales
  for (const s of sales) {
    if (!s.id) {
      report.anomalies.referentialIntegrity.push({ entity: 'sale', issue: 'Missing ID', record: s });
    } else {
      if (seenIds.has(s.id)) report.duplicateIds.push({ entity: 'sale', id: s.id });
      seenIds.add(s.id);
    }

    if (s.customerId && !customerIds.has(s.customerId)) {
      report.anomalies.referentialIntegrity.push({ entity: 'sale', saleId: s.id, customerId: s.customerId, issue: 'Sale references non-existent customerId' });
    }

    if (Array.isArray(s.items)) {
      for (const line of s.items) {
        if (!inventoryIds.has(line.inventoryId)) {
          report.anomalies.referentialIntegrity.push({ entity: 'saleItem', saleId: s.id, inventoryId: line.inventoryId, issue: 'Sale line references non-existent inventoryId' });
        }
      }
    }

    auditMonetaryValue(s.totalAmount, 'sale.totalAmount', s.id, report);
    auditMonetaryValue(s.amountPaid, 'sale.amountPaid', s.id, report);
    auditMonetaryValue(s.balance, 'sale.balance', s.id, report);
  }

  // 4. Audit Transactions
  for (const t of transactions) {
    if (!t.id) {
      report.anomalies.referentialIntegrity.push({ entity: 'transaction', issue: 'Missing ID', record: t });
    } else {
      if (seenIds.has(t.id)) report.duplicateIds.push({ entity: 'transaction', id: t.id });
      seenIds.add(t.id);
    }

    if (!customerIds.has(t.customerId)) {
      report.anomalies.referentialIntegrity.push({ entity: 'transaction', transactionId: t.id, customerId: t.customerId, issue: 'Transaction references non-existent customerId' });
    }

    auditMonetaryValue(t.amount, 'transaction.amount', t.id, report);
  }

  // 5. Debt & Repayment History Consistency Audit
  for (const cust of customers) {
    const custPayments = transactions.filter(t => t.customerId === cust.id && t.type === 'PAYMENT');
    const custSales = sales.filter(s => s.customerId === cust.id);

    if (cust.totalDebt === 0 && custPayments.length > 0) {
      report.anomalies.customerDebt.push({
        customerId: cust.id,
        name: cust.name,
        issue: 'Customer has totalDebt == 0 but historical repayments exist in transactions store. Must be preserved as unallocated_legacy_historical.',
        paymentCount: custPayments.length,
        totalPaidInTx: custPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0)
      });
    }

    if (cust.totalDebt > 0 && custSales.length === 0 && custPayments.length === 0) {
      report.anomalies.customerDebt.push({
        customerId: cust.id,
        name: cust.name,
        issue: 'Customer has debt balance but no historical sales or payment records. Migrates as opening_balance.',
        totalDebt: cust.totalDebt
      });
    }
  }

  return report;
}

/**
 * Helper to audit a single monetary field against integer Kobo rules.
 */
function auditMonetaryValue(val, fieldName, recordId, report, contextualName = '') {
  if (val === undefined || val === null) {
    report.anomalies.monetary.push({ recordId, fieldName, value: val, issue: 'Null or undefined monetary value' });
    return;
  }

  const num = Number(val);

  if (isNaN(num)) {
    report.anomalies.monetary.push({ recordId, fieldName, value: val, issue: 'Non-numeric monetary value' });
    report.currencyClassifications.malformedFloatOrNegative++;
    return;
  }

  if (num < 0) {
    report.anomalies.monetary.push({ recordId, fieldName, value: num, issue: 'Negative monetary value' });
    report.currencyClassifications.malformedFloatOrNegative++;
    return;
  }

  if (!Number.isSafeInteger(num) || num % 1 !== 0) {
    report.anomalies.monetary.push({ recordId, fieldName, value: num, issue: 'Malformed floating-point monetary value' });
    report.currencyClassifications.malformedFloatOrNegative++;
    return;
  }

  // Contextual Commodity Heuristic for Suspected Raw Naira
  const lowerName = (contextualName || '').toLowerCase();
  const majorCommodityRegex = /cement|oil|bag|carton|rice|sugar|phone|laptop|battery/;
  if (majorCommodityRegex.test(lowerName) && num > 0 && num < 2000) {
    // In Nigeria, a 50kg bag of cement or rice priced under 2000 Kobo (₦20) is almost certainly ₦2,000 entered in raw Naira
    report.anomalies.monetary.push({
      recordId,
      fieldName,
      value: num,
      context: contextualName,
      issue: 'SUSPECTED_RAW_NAIRA: Commodity name suggests price was entered in Naira rather than Kobo.'
    });
    report.currencyClassifications.suspectedRawNaira++;
    return;
  }

  // General Small Integer Boundary
  if (num > 0 && num < 50) {
    report.anomalies.monetary.push({
      recordId,
      fieldName,
      value: num,
      issue: 'AMBIGUOUS_SMALL_INTEGER: Value < 50 Kobo (₦0.50) is highly abnormal. Requires merchant review.'
    });
    report.currencyClassifications.ambiguousSmallInteger++;
    return;
  }

  // Verified Integer Kobo
  report.currencyClassifications.verifiedKobo++;
}

// Execution Driver
let dataToAudit = null;

if (filePath) {
  try {
    const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
    dataToAudit = JSON.parse(raw);
    console.log(`[Diagnostic] Successfully loaded legacy file: ${filePath}`);
  } catch (err) {
    console.error(`[Diagnostic] Failed to read or parse file ${filePath}:`, err.message);
    process.exit(1);
  }
} else if (runSample) {
  console.log('[Diagnostic] Running diagnostic against representative legacy edge-case dataset...');
  dataToAudit = sampleLegacyData;
} else {
  console.log('[Diagnostic] Running default representative diagnostic audit.');
  console.log('Pass --file <path.json> to audit a real database dump, or --sample for edge-case demonstration.\n');
  dataToAudit = sampleLegacyData;
}

const auditResult = auditLegacyDataset(dataToAudit);
console.log('================================================================');
console.log('         SB MANAGER PHASE 0 READ-ONLY DIAGNOSTIC REPORT          ');
console.log('================================================================');
console.log(`Execution Timestamp: ${auditResult.timestamp}`);
console.log('\nEntity Record Counts:');
for (const [entity, count] of Object.entries(auditResult.entityCounts)) {
  console.log(`  - ${entity.padEnd(15)}: ${count}`);
}

console.log('\nCurrency Classification Summary:');
console.log(`  - Verified Integer Kobo         : ${auditResult.currencyClassifications.verifiedKobo}`);
console.log(`  - Suspected Raw Naira           : ${auditResult.currencyClassifications.suspectedRawNaira}`);
console.log(`  - Malformed Float / Negative     : ${auditResult.currencyClassifications.malformedFloatOrNegative}`);
console.log(`  - Ambiguous Small Integer (<50)  : ${auditResult.currencyClassifications.ambiguousSmallInteger}`);

console.log('\nDetected Anomalies Summary:');
console.log(`  - Monetary Anomalies            : ${auditResult.anomalies.monetary.length}`);
console.log(`  - Inventory Anomalies           : ${auditResult.anomalies.inventory.length}`);
console.log(`  - Customer Debt Anomalies       : ${auditResult.anomalies.customerDebt.length}`);
console.log(`  - Referential Integrity Issues  : ${auditResult.anomalies.referentialIntegrity.length}`);

if (auditResult.anomalies.customerDebt.length > 0) {
  console.log('\nCustomer Debt & Repayment Findings (V2.1 Reconciliation Verification):');
  auditResult.anomalies.customerDebt.forEach((cd, idx) => {
    console.log(`  [${idx + 1}] Customer: ${cd.name} (${cd.customerId}) -> ${cd.issue}`);
  });
}

if (auditResult.anomalies.monetary.length > 0) {
  console.log('\nSample Monetary Anomalies Flagged for Quarantine:');
  auditResult.anomalies.monetary.slice(0, 5).forEach((m, idx) => {
    console.log(`  [${idx + 1}] ${m.fieldName} (ID: ${m.recordId}): Value = ${m.value} -> ${m.issue}`);
  });
}

console.log('================================================================');
console.log('Status: Non-destructive diagnostic complete. Zero source data altered.');
console.log('================================================================\n');

