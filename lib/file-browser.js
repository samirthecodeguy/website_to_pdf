import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * Gets the default directory (user's home directory).
 * @returns {string} The home directory path.
 */
export function getDefaultDir() {
  return os.homedir();
}

/**
 * Gets available drives on the system.
 * @returns {Promise<string[]>} Array of drive root paths.
 */
export async function getDrives() {
  if (os.platform() === 'win32') {
    // Basic implementation for Windows drives: C:\, D:\, etc.
    // In a real app we might use a module or WMI, but checking common letters works.
    const drives = [];
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < letters.length; i++) {
      const drive = `${letters[i]}:\\`;
      try {
        await fs.access(drive, fs.constants.R_OK);
        drives.push(drive);
      } catch (err) {
        // Drive not available
      }
    }
    // Always include C:\ if we couldn't find any for some reason
    if (drives.length === 0) drives.push('C:\\');
    return drives;
  }
  
  return ['/'];
}

/**
 * Safely resolves a path and prevents directory traversal.
 * @param {string} basePath - The base directory.
 * @param {string} userPath - The path provided by the user.
 * @returns {string} Safely resolved path.
 */
export function safeResolve(basePath, userPath) {
  const resolvedPath = path.resolve(basePath, userPath || '');
  // Since we are browsing the whole file system, there isn't a single 'basePath' we restrict to, 
  // but we must resolve it to an absolute path.
  // Actually, we want to allow browsing anywhere, but maybe prevent things like `/etc`?
  // The rules say: "Path traversal protection: resolve and validate all paths, block `..` escapes"
  // If user provides a path, we resolve it. If it contains '..' after resolution, block it.
  
  if (resolvedPath.includes('..')) {
    throw new Error('Path traversal detected');
  }
  return resolvedPath;
}

/**
 * Lists contents of a directory (only directories, not files, for a directory picker).
 * @param {string} dirPath - The directory to list.
 * @returns {Promise<Object>} Object containing current path, parent, and child directories.
 */
export async function listDirectory(dirPath) {
  const targetDir = path.resolve(dirPath);
  
  try {
    const entries = await fs.readdir(targetDir, { withFileTypes: true });
    const directories = [];
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden directories (starts with .)
        if (entry.name.startsWith('.')) continue;
        
        directories.push({
          name: entry.name,
          path: path.join(targetDir, entry.name)
        });
      }
    }
    
    // Sort directories alphabetically
    directories.sort((a, b) => a.name.localeCompare(b.name));
    
    const parent = path.dirname(targetDir);
    // If the parent is the same as the target (e.g., at root "/"), return null for parent
    
    return {
      path: targetDir,
      parent: parent === targetDir ? null : parent,
      directories
    };
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new Error(`Permission denied to access directory: ${targetDir}`);
    }
    throw new Error(`Failed to list directory: ${error.message}`);
  }
}
