import dns from 'node:dns/promises';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import turndownPluginGfm from 'turndown-plugin-gfm';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { registerCustomRules, applyPostProcessing } from './turndown-rules.js';

const { gfm } = turndownPluginGfm;

/**
 * Checks if an IP address is private or loopback to prevent SSRF.
 * @param {string} ip 
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('192.168.')) return true;
  
  if (ip.startsWith('172.')) {
    const secondOctet = parseInt(ip.split('.')[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }
  
  if (ip === '0.0.0.0') return true;
  if (ip === '::1') return true;
  if (ip.toLowerCase().startsWith('fd')) return true; // fd00::/8
  
  return false;
}

/**
 * Fetches the page content and follows redirects manually to protect against SSRF.
 * @param {string} targetUrl 
 * @param {number} redirectCount 
 * @returns {Promise<{html: string, finalUrl: string}>}
 */
export async function fetchPage(targetUrl, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error('Fetch failed: Too many redirects');
  }
  
  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (e) {
    throw new Error('Invalid URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid protocol: Only HTTP(S) is allowed');
  }

  try {
    const { address } = await dns.lookup(parsedUrl.hostname);
    if (isPrivateIP(address)) {
      throw new Error(`SSRF blocked: Host resolves to a private IP (${address})`);
    }
  } catch (e) {
    if (e.message.includes('SSRF')) throw e;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      signal: controller.signal,
      redirect: 'manual'
    });
    
    clearTimeout(timeoutId);

    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      const location = res.headers.get('location');
      const nextUrl = new URL(location, targetUrl).toString();
      return fetchPage(nextUrl, redirectCount + 1);
    }

    if (!res.ok) {
      throw new Error(`Fetch failed: HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/xml')) {
      throw new Error('Fetch failed: Target is not an HTML page');
    }

    const html = await res.text();
    return { html, finalUrl: targetUrl };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Fetch failed: connection timed out after 15s');
    }
    throw error;
  }
}

/**
 * Extracts metadata from the document
 * @param {Document} document 
 * @param {string} url 
 * @returns {object}
 */
export function extractMetadata(document, url) {
  const meta = (name) => document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content');
  return {
    title: document.title || meta('og:title') || meta('twitter:title') || '',
    description: meta('description') || meta('og:description') || meta('twitter:description') || '',
    author: meta('author') || meta('article:author') || '',
    date: meta('article:published_time') || meta('date') || '',
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || url,
  };
}

/**
 * Downloads a single image with size and content-type validation.
 * @param {string} targetUrl 
 * @param {string} tempDir 
 * @returns {Promise<{filename: string, tempPath: string}>}
 */
async function downloadSingleImage(targetUrl, tempDir) {
  const parsedUrl = new URL(targetUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Invalid protocol');
  }

  const { address } = await dns.lookup(parsedUrl.hostname);
  if (isPrivateIP(address)) {
    throw new Error('SSRF Blocked');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const res = await fetch(targetUrl, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > 10 * 1024 * 1024) {
    throw new Error('Image exceeds 10MB');
  }

  // Sanitize filename
  let ext = path.extname(parsedUrl.pathname);
  if (!ext || ext.length > 5) {
    const mimeMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' };
    ext = mimeMap[contentType] || '.jpg';
  }
  
  const basename = path.basename(parsedUrl.pathname, ext);
  const sanitizedBase = basename.replace(/[^a-zA-Z0-9_-]/g, '') || crypto.randomBytes(4).toString('hex');
  const filename = `${sanitizedBase}-${crypto.randomBytes(2).toString('hex')}${ext}`;
  const finalPath = path.join(tempDir, filename);
  const partialPath = `${finalPath}.part`;

  let loaded = 0;
  let fileHandle;
  try {
    fileHandle = await fs.open(partialPath, 'w');
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.length;
        if (loaded > 10 * 1024 * 1024) {
          throw new Error('Image exceeds 10MB during download');
        }
        await fileHandle.write(value);
      }
    } else {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length > 10 * 1024 * 1024) throw new Error('Image exceeds 10MB');
      await fileHandle.write(buffer);
    }
  } catch (err) {
    if (fileHandle) await fileHandle.close();
    await fs.unlink(partialPath).catch(() => {});
    throw err;
  }
  if (fileHandle) await fileHandle.close();

  await fs.rename(partialPath, finalPath);

  return { filename, tempPath: finalPath };
}

/**
 * Downloads multiple images with concurrency limit.
 * @param {string[]} imageUrls 
 * @param {string} tempDir 
 * @returns {Promise<any[]>}
 */
export async function downloadImages(imageUrls, tempDir) {
  const results = [];
  let index = 0;
  
  const worker = async () => {
    while (index < imageUrls.length) {
      const currentIndex = index++;
      const url = imageUrls[currentIndex];
      try {
        const result = await downloadSingleImage(url, tempDir);
        results.push({ status: 'fulfilled', originalUrl: url, ...result });
      } catch (err) {
        console.warn(`Failed to download ${url}: ${err.message}`);
        results.push({ status: 'rejected', originalUrl: url, error: err.message });
      }
    }
  };
  
  const workers = Array.from({ length: Math.min(5, imageUrls.length) }, worker);
  await Promise.all(workers);
  
  return results;
}

/**
 * Serializes metadata object to YAML frontmatter block.
 * @param {object} metadata 
 * @returns {string}
 */
export function generateFrontmatter(metadata) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(metadata)) {
    if (value) {
      const safeValue = String(value).replace(/"/g, '\\"');
      lines.push(`${key}: "${safeValue}"`);
    }
  }
  lines.push('---');
  return lines.length > 2 ? lines.join('\n') : '';
}

/**
 * Converts HTML to Markdown using Turndown.
 * @param {string} html 
 * @returns {string}
 */
export function htmlToMarkdown(html) {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  turndownService.use(gfm);
  
  const rulesState = registerCustomRules(turndownService);
  const rawMarkdown = turndownService.turndown(html);
  
  return applyPostProcessing(rawMarkdown, rulesState);
}

/**
 * Main pipeline orchestrator for Phase 2.
 * @param {string} url 
 * @returns {Promise<{markdown: string, metadata: any, images: any[], tempDir: string}>}
 */
export async function processUrl(url) {
  const { html, finalUrl } = await fetchPage(url);
  
  const dom = new JSDOM(html, { url: finalUrl });
  const document = dom.window.document;
  
  const metadata = extractMetadata(document, finalUrl);
  if (!metadata.title) {
    metadata.title = document.title;
  }
  
  const reader = new Readability(document);
  const article = reader.parse();
  
  if (!article) {
    throw new Error('Conversion failed: Failed to extract readable content from page');
  }
  
  const contentDom = new JSDOM(article.content, { url: finalUrl });
  const contentDoc = contentDom.window.document;
  const imgs = Array.from(contentDoc.querySelectorAll('img'));
  
  // Deduplicate URLs
  const rawImageUrls = imgs.map(img => img.src).filter(Boolean);
  const imageUrls = [...new Set(rawImageUrls)];
  
  let downloadedImages = [];
  let tempDir = null;
  
  if (imageUrls.length > 0) {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'web2md-'));
    downloadedImages = await downloadImages(imageUrls, tempDir);
    
    // Replace img src with local paths for successful downloads
    for (const img of imgs) {
      if (!img.src) continue;
      const downloaded = downloadedImages.find(d => d.originalUrl === img.src && d.status === 'fulfilled');
      if (downloaded) {
        img.src = `./images/${downloaded.filename}`;
      }
    }
  }

  const finalHtml = contentDoc.body.innerHTML;
  let markdown = htmlToMarkdown(finalHtml);
  
  const frontmatter = generateFrontmatter(metadata);
  if (frontmatter) {
    markdown = `${frontmatter}\n\n${markdown}`;
  }
  
  // Conversion quality check: Warn if output is suspiciously short
  if (markdown.length < 50 && html.length > 500) {
    console.warn(`Conversion quality check: Output Markdown is suspiciously short (${markdown.length} chars) for url: ${url}`);
    // We could append a warning to the markdown itself or handle it differently
  }
  
  return {
    markdown,
    metadata,
    images: downloadedImages,
    tempDir
  };
}
