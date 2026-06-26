import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { processUrl } from './lib/converter.js';
import { listDirectory, getDrives, getDefaultDir, safeResolve } from './lib/file-browser.js';
import * as history from './lib/history.js';

const activeTempDirs = new Set();

const cleanupTempDirs = async () => {
  console.log('\nCleaning up temp directories...');
  for (const dir of activeTempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (e) {
      console.error(`Failed to delete ${dir}:`, e.message);
    }
  }
  process.exit(0);
};

process.on('SIGINT', cleanupTempDirs);
process.on('SIGTERM', cleanupTempDirs);


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://cdn.jsdelivr.net");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// JSON body parser with 1MB limit
app.use(express.json({ limit: '1mb' }));

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// API Route for conversion
app.post('/api/convert', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: {
          code: 'INVALID_URL',
          message: 'A valid URL string is required.'
        }
      });
    }

    const { markdown, metadata, images, tempDir } = await processUrl(url);

    if (tempDir) {
      activeTempDirs.add(tempDir);
    }

    res.json({ markdown, metadata, images: images || [] });
  } catch (error) {
    console.error('Conversion error:', error);
    
    // Default to 500
    let statusCode = 500;
    let errorCode = 'CONVERSION_FAILED';
    
    if (error.message.includes('Invalid URL') || error.message.includes('Invalid protocol')) {
      statusCode = 400;
      errorCode = 'INVALID_URL';
    } else if (error.message.toLowerCase().includes('fetch failed') || error.name === 'AbortError') {
      statusCode = 502; // Bad Gateway
      errorCode = 'FETCH_FAILED';
    } else if (error.message.includes('SSRF')) {
      statusCode = 403;
      errorCode = 'FORBIDDEN_URL';
    }

    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: error.message || 'An unexpected error occurred during conversion.'
      }
    });
  }
});

// --- Phase 4 Routes ---

// API Route to browse directories
app.post('/api/browse', async (req, res) => {
  try {
    const { dirPath, getDrives: reqGetDrives } = req.body;
    
    if (reqGetDrives) {
      const drives = await getDrives();
      return res.json({ drives, defaultDir: getDefaultDir() });
    }
    
    const targetDir = dirPath ? safeResolve('/', dirPath) : getDefaultDir();
    const result = await listDirectory(targetDir);
    res.json(result);
  } catch (error) {
    console.error('Browse error:', error);
    res.status(400).json({
      error: {
        code: 'BROWSE_ERROR',
        message: error.message
      }
    });
  }
});

// API Route to save markdown and images
app.post('/api/save', async (req, res) => {
  try {
    const { markdown, images, savePath, filename, url, title } = req.body;
    
    if (!savePath || !filename) {
      throw new Error('Save path and filename are required');
    }
    
    // Sanitize filename
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFilename.endsWith('.md')) {
      throw new Error('Filename must end with .md');
    }
    
    // Resolve and validate save directory
    const resolvedSavePath = safeResolve('/', savePath);
    
    // Check if directory exists
    try {
      const stat = await fs.stat(resolvedSavePath);
      if (!stat.isDirectory()) throw new Error('Save path is not a directory');
    } catch (e) {
      throw new Error('Save directory does not exist or is inaccessible');
    }
    
    // Create atomic write function (write to temp then rename)
    const writeAtomically = async (targetPath, content) => {
      const tempPath = targetPath + '.tmp.' + Date.now();
      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, targetPath);
    };

    // Save markdown file
    const mdFilePath = path.join(resolvedSavePath, safeFilename);
    await writeAtomically(mdFilePath, markdown);
    
    let savedImageCount = 0;
    
    // Save images
    if (images && images.length > 0) {
      const imagesDir = path.join(resolvedSavePath, 'images');
      await fs.mkdir(imagesDir, { recursive: true });
      
      for (const img of images) {
        if (img.tempPath) {
          const destPath = path.join(imagesDir, img.filename);
          // Copy from tempPath
          try {
            await fs.copyFile(img.tempPath, destPath);
            savedImageCount++;
          } catch (e) {
            console.warn(`Failed to copy image ${img.filename}:`, e);
          }
        }
      }
    }
    
    // Add to history
    const entry = await history.addEntry({
      url,
      title,
      savePath: resolvedSavePath,
      filename: safeFilename,
      imageCount: savedImageCount
    });
    
    res.json({ success: true, entry, mdFilePath });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({
      error: {
        code: 'SAVE_FAILED',
        message: error.message
      }
    });
  }
});

// API Route to get history
app.get('/api/history', async (req, res) => {
  try {
    const entries = await history.getAll();
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: { code: 'HISTORY_ERROR', message: error.message } });
  }
});

// API Route to delete history entry
app.delete('/api/history/:id', async (req, res) => {
  try {
    const success = await history.deleteById(req.params.id);
    if (!success) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'History entry not found' } });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: { code: 'HISTORY_ERROR', message: error.message } });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
