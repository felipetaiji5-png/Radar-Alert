import { haversineMeters } from './geo-math.js';

const DB_NAME = 'radar-alert-production-db';
const DB_VERSION = 3;
const DATASETS = 'datasets';
const SETTINGS = 'settings';
const ROAD_NETWORKS = 'roadNetworks';
const MAX_DATASET_AGE_DAYS = 30;
const MAX_ROAD_NETWORK_REGIONS = 24;

// Retorna -Infinity para geometrias que não cobrem a posição. Preferimos uma
// região atualizada e, em seguida, aquela com mais margem até sua borda.
export function roadCacheSuitability(record, position, margin = 0.95, now = Date.now()) {
  const center = record?.data?.metadata?.center;
  const radius = Number(record?.data?.metadata?.radiusMeters);
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng) ||
      !Number.isFinite(position?.lat) || !Number.isFinite(position?.lng) ||
      !Number.isFinite(radius) || radius <= 0 ||
      !Array.isArray(record?.data?.osm?.elements) || !record.data.osm.elements.length) return -Infinity;
  const remaining = radius * margin - haversineMeters(center, position);
  if (remaining < 0) return -Infinity;
  const date = new Date(record.savedAt || '').getTime();
  const fresh = Number.isFinite(date) && date > 0 && date <= now && now - date < 30 * 86400000;
  return (fresh ? 100000 : 0) + remaining;
}


export class OfflineStore {
  static dbPromise = null;
  static openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(DATASETS)) db.createObjectStore(DATASETS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(ROAD_NETWORKS)) db.createObjectStore(ROAD_NETWORKS, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); this.dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => { this.dbPromise = null; reject(request.error); };
    });
    return this.dbPromise;
  }
  static async put(storeName, record) {
    const db = await this.openDb();
    if (!db) return false;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação IndexedDB cancelada.'));
    });
    return true;
  }
  static async get(storeName, key) {
    const db = await this.openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  static async saveDataset(key, data) {
    try { return await this.put(DATASETS, { key, data, savedAt: new Date().toISOString(), timestamp: Date.now() }); }
    catch (error) { console.warn('Não foi possível salvar o cache de radares:', error); return false; }
  }
  static async getDataset(key) { try { return await this.get(DATASETS, key); } catch { return null; } }
  static async saveRoadNetwork(key, data) {
    try {
      const saved = await this.put(ROAD_NETWORKS, { key, data, savedAt: new Date().toISOString(), timestamp: Date.now() });
      if (saved) {
        try { await this.pruneRoadNetworks(); }
        catch (error) { console.warn('Cache OSM salvo, mas não foi possível reduzir seu tamanho:', error); }
      }
      return saved;
    } catch (error) { console.warn('Não foi possível salvar a malha viária:', error); return false; }
  }
  static async getRoadNetwork(key) { try { return await this.get(ROAD_NETWORKS, key); } catch { return null; } }
  static async findCoveringRoadNetwork(position, { margin = 0.95 } = {}) {
    try {
      const db = await this.openDb();
      if (!db) return null;
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(ROAD_NETWORKS, 'readonly');
        const cursorRequest = tx.objectStore(ROAD_NETWORKS).openCursor();
        let best = null, bestScore = -Infinity;
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          const score = roadCacheSuitability(cursor.value, position, margin);
          if (score > bestScore) { best = cursor.value; bestScore = score; }
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
        tx.oncomplete = () => resolve(best);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Leitura do cache OSM cancelada.'));
      });
    } catch (error) { console.warn('Não foi possível pesquisar regiões OSM salvas:', error); return null; }
  }
  static async pruneRoadNetworks(maxEntries = MAX_ROAD_NETWORK_REGIONS) {
    const db = await this.openDb();
    if (!db) return 0;
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(ROAD_NETWORKS, 'readonly');
      const request = tx.objectStore(ROAD_NETWORKS).openCursor();
      const result = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        result.push({ key: cursor.primaryKey, timestamp: Number(cursor.value?.timestamp) || 0 });
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
    });
    if (rows.length <= maxEntries) return 0;
    rows.sort((a, b) => a.timestamp - b.timestamp);
    const removed = rows.slice(0, rows.length - maxEntries);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ROAD_NETWORKS, 'readwrite');
      const objectStore = tx.objectStore(ROAD_NETWORKS);
      for (const row of removed) objectStore.delete(row.key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return removed.length;
  }
  static async saveSetting(key, value) {
    try { return await this.put(SETTINGS, { key, value, savedAt: Date.now() }); } catch { return false; }
  }
  static async getSetting(key) { try { return await this.get(SETTINGS, key); } catch { return null; } }
  static isDatasetStale(savedAt) {
    const time = new Date(savedAt || '').getTime();
    return !Number.isFinite(time) || time <= 0 || Date.now() - time > MAX_DATASET_AGE_DAYS * 86400000;
  }
  static async clearAllLocalData() {
    try {
      const db = await this.openDb();
      if (db) await new Promise((resolve, reject) => {
        const tx = db.transaction([DATASETS, SETTINGS, ROAD_NETWORKS], 'readwrite');
        tx.objectStore(DATASETS).clear(); tx.objectStore(SETTINGS).clear(); tx.objectStore(ROAD_NETWORKS).clear();
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      if (typeof localStorage !== 'undefined') {
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('radar-alert:')) localStorage.removeItem(key);
        }
      }
      return true;
    } catch (error) { console.error('Falha ao limpar dados locais:', error); return false; }
  }
}
