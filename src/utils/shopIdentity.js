/**
 * Retrieves the persistent shopId from localStorage.
 * If one does not exist, generates a new UUID, saves it, and returns it.
 * Also generates a 30-day trial expiration timestamp.
 * 
 * @returns {string} The persistent UUID for this device's shop.
 */
export function getShopId() {
  let shopId = localStorage.getItem('shopId');
  if (!shopId) {
    shopId = crypto.randomUUID();
    localStorage.setItem('shopId', shopId);
    
    // Set trial expiration for 30 days from now
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 30);
    localStorage.setItem('trialEndsAt', trialEndsAt.toISOString());
  }
  return shopId;
}

/**
 * Checks if the 30-day local trial has expired.
 * 
 * @returns {boolean} True if the trial is expired, false otherwise.
 */
export function isTrialExpired() {
  const trialEndsAtStr = localStorage.getItem('trialEndsAt');
  if (!trialEndsAtStr) return false;
  
  const trialEndsAt = new Date(trialEndsAtStr);
  return new Date() > trialEndsAt;
}
