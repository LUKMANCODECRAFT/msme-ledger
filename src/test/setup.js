import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';

class MemoryStorage {
  constructor() {
    this.store = {};
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
  clear() {
    this.store = {};
  }
  get length() {
    return Object.keys(this.store).length;
  }
  key(index) {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

const mockStorage = new MemoryStorage();
Object.defineProperty(window, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
  configurable: true
});

beforeEach(() => {
  mockStorage.clear();
});
