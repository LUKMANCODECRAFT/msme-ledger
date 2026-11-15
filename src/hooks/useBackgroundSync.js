import { useEffect } from 'react';
import { pushPendingData } from '../services/syncService.js';

/**
 * Custom React hook that manages the lifecycle of the background sync service.
 * Attaches native browser online event listeners and initiates a periodic sync interval.
 */
export function useBackgroundSync() {
  useEffect(() => {
    // Native event listener handler
    const handleOnline = () => {
      pushPendingData().catch(() => {});
    };

    // Attach native event listener for when the network drops and reconnects
    window.addEventListener('online', handleOnline);

    // Initial check when the component mounts
    if (navigator.onLine) {
      pushPendingData().catch(() => {});
    }

    // Set interval to poll every 3 minutes (180000ms)
    const SYNC_INTERVAL_MS = 180000;
    const intervalId = setInterval(() => {
      // ONLY trigger the sync if the browser explicitly reports it is online
      if (navigator.onLine) {
        pushPendingData().catch(() => {});
      }
    }, SYNC_INTERVAL_MS);

    // Cleanup phase to prevent memory leaks and zombie intervals
    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(intervalId);
    };
  }, []);
}
