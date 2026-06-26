import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { processUrl } from './lib/converter.js';

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
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:");
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
    } else if (error.message.includes('Fetch failed') || error.name === 'AbortError') {
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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
