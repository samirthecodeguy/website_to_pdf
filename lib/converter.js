import dns from 'node:dns/promises';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import turndownPluginGfm from 'turndown-plugin-gfm';

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
    // If dns lookup fails here, we let it fail in fetch.
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
 * Extracts article content from HTML using Readability.
 * @param {string} html 
 * @param {string} url 
 * @returns {{contentHtml: string, title: string}}
 */
export function extractContent(html, url) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();
  
  if (!article) {
    throw new Error('Conversion failed: Failed to extract readable content from page');
  }
  
  return {
    contentHtml: article.content,
    title: article.title
  };
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
  
  return turndownService.turndown(html);
}

/**
 * Main pipeline orchestrator for Phase 1.
 * @param {string} url 
 * @returns {Promise<{markdown: string, metadata: any}>}
 */
export async function processUrl(url) {
  const { html, finalUrl } = await fetchPage(url);
  const { contentHtml, title } = extractContent(html, finalUrl);
  const markdown = htmlToMarkdown(contentHtml);
  
  return {
    markdown,
    metadata: { title, source: finalUrl }
  };
}
