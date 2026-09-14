/**
 * Retrieves the persistent shopId from localStorage.
 * If one does not exist, generates a new UUID, saves it, and returns it.
 * 
 * @returns {string} The persistent UUID for this device's shop.
 */
export function getShopId() {
  let shopId = localStorage.getItem('shopId');
  if (!shopId) {
    shopId = crypto.randomUUID();
    localStorage.setItem('shopId', shopId);
  }
  return shopId;
}
