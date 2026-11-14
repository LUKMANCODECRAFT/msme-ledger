/**
 * Shared Formatting and Financial Display Utilities
 * Conforms to SB Manager Rebuild Blueprint v2.1 Section 6.
 * 
 * Rules:
 * - All monetary inputs represent Integer Kobo (1 NGN = 100 Kobo).
 * - Division by 100 is strictly for display/presentation purposes only.
 * - Negative amounts are handled cleanly with proper currency symbols.
 * - Missing or NaN values fail safe to ₦0.00 without throwing render exceptions.
 */

/**
 * Formats integer kobo into standard Nigerian Naira string.
 * E.g. 150000 kobo -> "₦1,500.00"
 * 
 * @param {number|string} koboAmount - Amount in integer kobo
 * @param {Object} [options]
 * @param {boolean} [options.hideDecimals=false]
 * @returns {string} Formatted Naira string
 */
export function formatNaira(koboAmount, options = {}) {
  const parsedKobo = typeof koboAmount === 'number' ? koboAmount : parseInt(koboAmount, 10);
  if (isNaN(parsedKobo)) {
    return '₦0.00';
  }

  const nairaValue = parsedKobo / 100;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: options.hideDecimals ? 0 : 2,
    maximumFractionDigits: options.hideDecimals ? 0 : 2
  }).format(nairaValue);
}

/**
 * Formats a date string or Date object into localized Nigerian standard.
 * 
 * @param {string|Date|number} dateValue
 * @param {Object} [options]
 * @returns {string}
 */
export function formatDate(dateValue, options = {}) {
  if (!dateValue) return '—';
  try {
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('en-NG', {
      dateStyle: options.dateStyle || 'medium',
      timeStyle: options.timeStyle || 'short'
    }).format(d);
  } catch {
    return '—';
  }
}

/**
 * Formats a date into a short date string (e.g., "14 Nov 2026").
 * 
 * @param {string|Date|number} dateValue
 * @returns {string}
 */
export function formatDateShort(dateValue) {
  return formatDate(dateValue, { dateStyle: 'medium', timeStyle: undefined });
}

/**
 * Formats an integer number with commas (e.g. 1500 -> "1,500").
 * 
 * @param {number} num
 * @returns {string}
 */
export function formatNumber(num) {
  const parsed = typeof num === 'number' ? num : parseInt(num, 10);
  if (isNaN(parsed)) return '0';
  return new Intl.NumberFormat('en-NG').format(parsed);
}

/**
 * Sanitizes and formats a Nigerian phone number for WhatsApp links or display.
 * E.g. "08012345678" -> "2348012345678"
 * 
 * @param {string} phone
 * @returns {string} Clean numeric phone with country code 234
 */
export function formatNigerianPhone(phone) {
  if (!phone || typeof phone !== 'string') return '';
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) {
    cleanPhone = '234' + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith('234')) {
    cleanPhone = '234' + cleanPhone;
  }
  return cleanPhone;
}

/**
 * Formats a Nigerian phone number for human-readable display.
 * E.g. "08012345678" -> "0801 234 5678"
 * 
 * @param {string} phone
 * @returns {string}
 */
export function formatPhoneDisplay(phone) {
  if (!phone || typeof phone !== 'string') return '—';
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('0')) {
    return `${clean.slice(0, 4)} ${clean.slice(4, 7)} ${clean.slice(7)}`;
  }
  if (clean.length === 13 && clean.startsWith('234')) {
    return `+234 ${clean.slice(3, 6)} ${clean.slice(6, 9)} ${clean.slice(9)}`;
  }
  return phone;
}

/**
 * Generates a direct WhatsApp link for debt collection reminders.
 * 
 * @param {Object} customer
 * @param {string} customer.name
 * @param {string} customer.phone
 * @param {number} customer.totalDebt - Amount in integer kobo
 * @param {string} [shopName]
 * @returns {string} WhatsApp URL
 */
export function generateWhatsAppLink(customer, shopName) {
  const formattedPhone = formatNigerianPhone(customer.phone);
  const formattedDebt = formatNaira(customer.totalDebt);
  const business = shopName || localStorage.getItem('shopName') || 'MSME Ledger Store';

  const rawText = `Hello ${customer.name}, this is a polite reminder from ${business} regarding your outstanding balance of ${formattedDebt}. Please let us know when you can settle this. Thank you for your business.`;
  const encodedText = encodeURIComponent(rawText);

  return `https://wa.me/${formattedPhone}?text=${encodedText}`;
}
