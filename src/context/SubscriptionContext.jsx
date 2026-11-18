/**
 * Subscription & Entitlement Context — SBM-042
 * Manages manual bank-transfer subscription workflows, offline entitlement tokens,
 * and anti-clock-tampering evaluations (Blueprint v2.1 Section 15.2).
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext.jsx';
import { verifyEntitlementOffline } from '../domain/subscription/entitlementVerifier.js';

const SubscriptionContext = createContext(null);

const STORAGE_KEY_ENTITLEMENT = 'msme_entitlement';
const STORAGE_KEY_LAST_SERVER_TIME = 'last_known_server_time';

export function SubscriptionProvider({ children, initialEntitlement = null }) {
  const { currentBusinessId, token } = useAuth();

  const [subscription, setSubscription] = useState(() => {
    if (initialEntitlement) return initialEntitlement;
    const stored = localStorage.getItem(STORAGE_KEY_ENTITLEMENT);
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });

  const [bankDetails, setBankDetails] = useState(null);
  const [paymentReference, setPaymentReference] = useState(null);
  const [plans, setPlans] = useState([]);
  const [lastKnownServerTime, setLastKnownServerTime] = useState(() => {
    const val = localStorage.getItem(STORAGE_KEY_LAST_SERVER_TIME);
    return val ? parseInt(val, 10) : 0;
  });

  const apiUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL)
    ? import.meta.env.VITE_API_URL
    : (typeof process !== 'undefined' && process.env?.VITE_API_URL
      ? process.env.VITE_API_URL
      : 'http://localhost:3000');

  // Evaluate offline entitlement against local clock and anti-tampering baseline
  const evaluation = verifyEntitlementOffline(
    subscription,
    Date.now(),
    lastKnownServerTime
  );

  const entitlementStatus = evaluation.status;
  const isReadOnly = evaluation.readOnly;

  // Persist entitlement to localStorage
  useEffect(() => {
    if (subscription) {
      localStorage.setItem(STORAGE_KEY_ENTITLEMENT, JSON.stringify(subscription));
    }
  }, [subscription]);

  const updateServerTime = useCallback((serverTimestamp) => {
    if (typeof serverTimestamp === 'number' && serverTimestamp > lastKnownServerTime) {
      setLastKnownServerTime(serverTimestamp);
      localStorage.setItem(STORAGE_KEY_LAST_SERVER_TIME, String(serverTimestamp));
    }
  }, [lastKnownServerTime]);

  const getInstructions = useCallback(async () => {
    try {
      const headers = { 'X-Business-ID': currentBusinessId };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${apiUrl}/api/v2/subscription/instructions`, { headers });
      const data = await res.json();
      if (res.ok && data.success) {
        setBankDetails(data.bankDetails);
        setPaymentReference(data.paymentReference);
        setPlans(data.plans || []);
        updateServerTime(Date.now());
        return data;
      }
      throw new Error(data.message || 'Failed to retrieve subscription instructions.');
    } catch (err) {
      // In offline mode or when backend is unavailable, return local fallback without hardcoded fake keys
      return {
        bankDetails: {
          bankName: 'UBA',
          accountName: 'Lukman Yerima Ismail',
          accountNumber: '2453591351'
        },
        paymentReference: `REF-SB-${Date.now().toString(16).toUpperCase()}`,
        plans: [
          { id: 'pro', name: 'Professional Merchant', priceKobo: 500000, durationDays: 30, gracePeriodDays: 7 },
          { id: 'enterprise', name: 'Enterprise Multi-Shop', priceKobo: 1500000, durationDays: 30, gracePeriodDays: 7 }
        ]
      };
    }
  }, [apiUrl, currentBusinessId, token, updateServerTime]);

  const submitProof = useCallback(async ({ planId, reference, amount, proofImageUrl = null }) => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Business-ID': currentBusinessId
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiUrl}/api/v2/subscription/submit`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        planId,
        paymentReference: reference,
        amount,
        proofImageUrl
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || 'Proof submission failed.');
    }

    setSubscription(data.subscription);
    updateServerTime(Date.now());
    return data;
  }, [apiUrl, currentBusinessId, token, updateServerTime]);

  const value = {
    subscription,
    entitlementStatus,
    isReadOnly,
    statusMessage: evaluation.message,
    bankDetails,
    paymentReference,
    plans,
    getInstructions,
    submitProof,
    setSubscription,
    updateServerTime
  };

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    return {
      subscription: null,
      entitlementStatus: 'active',
      isReadOnly: false,
      statusMessage: 'Local retail mode active',
      bankDetails: null,
      paymentReference: null,
      plans: [],
      getInstructions: async () => {},
      submitProof: async () => {},
      setSubscription: () => {},
      updateServerTime: () => {}
    };
  }
  return context;
}
