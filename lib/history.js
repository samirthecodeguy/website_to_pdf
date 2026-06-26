import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/**
 * Gets the history storage directory path based on the OS.
 * @returns {string} The path to the storage directory.
 */
function getStorageDir() {
  if (os.platform() === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'web2md');
  }
  return path.join(os.homedir(), '.web2md');
}

const HISTORY_DIR = getStorageDir();
const HISTORY_FILE = path.join(HISTORY_DIR, 'history.json');

/**
 * Ensures the history directory and file exist.
 * @returns {Promise<void>}
 */
async function ensureStorageExists() {
  try {
    await fs.mkdir(HISTORY_DIR, { recursive: true });
    try {
      await fs.access(HISTORY_FILE, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      if (err.code === 'ENOENT') {
        await fs.writeFile(HISTORY_FILE, JSON.stringify([]), 'utf8');
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('Failed to initialize history storage:', err);
    throw new Error('Could not access history storage');
  }
}

/**
 * Reads all history entries.
 * @returns {Promise<Array>} List of history entries.
 */
export async function getAll() {
  await ensureStorageExists();
  try {
    const data = await fs.readFile(HISTORY_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Failed to read history:', err);
    return [];
  }
}

/**
 * Atomically writes history entries to the file.
 * Uses a temp file and rename pattern to prevent corruption.
 * @param {Array} entries - The history entries to write.
 * @returns {Promise<void>}
 */
async function writeEntries(entries) {
  await ensureStorageExists();
  const tempFile = path.join(HISTORY_DIR, `history.json.tmp.${crypto.randomBytes(4).toString('hex')}`);
  try {
    await fs.writeFile(tempFile, JSON.stringify(entries, null, 2), 'utf8');
    await fs.rename(tempFile, HISTORY_FILE);
  } catch (err) {
    try {
      await fs.unlink(tempFile);
    } catch (e) {
      // Ignore cleanup error
    }
    throw new Error(`Failed to save history: ${err.message}`);
  }
}

/**
 * Gets a specific history entry by ID.
 * @param {string} id - The ID of the entry.
 * @returns {Promise<Object|null>} The entry or null if not found.
 */
export async function getById(id) {
  const entries = await getAll();
  return entries.find(entry => entry.id === id) || null;
}

/**
 * Adds a new history entry.
 * @param {Object} entryData - The data for the new entry.
 * @returns {Promise<Object>} The created entry.
 */
export async function addEntry(entryData) {
  const entries = await getAll();
  
  const newEntry = {
    id: crypto.randomUUID(),
    url: entryData.url,
    title: entryData.title || 'Untitled',
    date: new Date().toISOString(),
    status: entryData.status || 'success',
    savePath: entryData.savePath,
    filename: entryData.filename,
    imageCount: entryData.imageCount || 0
  };
  
  // Add to the beginning of the list
  entries.unshift(newEntry);
  
  // Keep history manageable (e.g., last 100 entries)
  if (entries.length > 100) {
    entries.length = 100;
  }
  
  await writeEntries(entries);
  return newEntry;
}

/**
 * Deletes a history entry by ID.
 * @param {string} id - The ID of the entry to delete.
 * @returns {Promise<boolean>} True if deleted, false if not found.
 */
export async function deleteById(id) {
  const entries = await getAll();
  const initialLength = entries.length;
  
  const filteredEntries = entries.filter(entry => entry.id !== id);
  
  if (filteredEntries.length === initialLength) {
    return false; // Not found
  }
  
  await writeEntries(filteredEntries);
  return true;
}
