/**
 * Custom Turndown rules for extended Markdown syntax
 */

export function registerCustomRules(turndownService) {
  const state = {
    abbreviations: new Map()
  };

  // Definition Lists
  turndownService.addRule('dl', {
    filter: 'dl',
    replacement: (content) => '\n\n' + content + '\n\n'
  });

  turndownService.addRule('dt', {
    filter: 'dt',
    replacement: (content) => '\n' + content.trim() + '\n'
  });

  turndownService.addRule('dd', {
    filter: 'dd',
    replacement: (content) => ': ' + content.trim() + '\n\n'
  });

  // Abbreviations
  turndownService.addRule('abbr', {
    filter: 'abbr',
    replacement: (content, node) => {
      const title = node.getAttribute('title');
      if (title) {
        state.abbreviations.set(content.trim(), title.trim());
      }
      return content;
    }
  });

  // Footnotes - References
  turndownService.addRule('footnoteRef', {
    filter: (node) => {
      if (node.nodeName === 'SUP') {
        const a = node.querySelector('a');
        if (a && (a.getAttribute('href') || '').startsWith('#cite_note') || (a && (a.getAttribute('href') || '').startsWith('#fn'))) {
          return true;
        }
      }
      return false;
    },
    replacement: (content, node) => {
      const a = node.querySelector('a');
      const href = a.getAttribute('href');
      // Try to extract footnote ID from href or text
      let id = href.replace(/^#(cite_note-|fn-?)/, '');
      if (!id) id = content.replace(/\[|\]/g, '').trim();
      return `[^${id}]`;
    }
  });

  // Footnotes - Definitions (Wikipedia style and standard)
  turndownService.addRule('footnoteDef', {
    filter: (node) => {
      if (node.nodeName !== 'LI') return false;
      const id = node.getAttribute('id') || '';
      return id.startsWith('cite_note-') || id.startsWith('fn');
    },
    replacement: (content, node) => {
      const id = (node.getAttribute('id') || '').replace(/^(cite_note-|fn-?)/, '');
      const cleanContent = content.trim().replace(/\n/g, '\n  ');
      return `\n[^${id}]: ${cleanContent}\n`;
    }
  });

  // Superscript
  turndownService.addRule('sup', {
    filter: (node) => {
      return node.nodeName === 'SUP' && !node.querySelector('a');
    },
    replacement: (content) => `^${content}^`
  });

  // Subscript
  turndownService.addRule('sub', {
    filter: 'sub',
    replacement: (content) => `~${content}~`
  });

  // Code language detection
  turndownService.addRule('fencedCodeBlock', {
    filter: (node, options) => {
      return (
        options.codeBlockStyle === 'fenced' &&
        node.nodeName === 'PRE' &&
        node.firstChild &&
        node.firstChild.nodeName === 'CODE'
      );
    },
    replacement: (content, node, options) => {
      const className = node.firstChild.className || node.className || '';
      const languageMatch = className.match(/language-([^\s]+)/);
      const language = languageMatch ? languageMatch[1] : '';
      const code = node.firstChild.textContent;
      const fence = options.fence || '```';
      return `\n\n${fence}${language}\n${code}\n${fence}\n\n`;
    }
  });

  return state;
}

/**
 * Post-processing pass to append abbreviations and cleanup excessive blank lines.
 */
export function applyPostProcessing(markdown, state) {
  let processed = markdown;
  
  // Append abbreviations
  if (state && state.abbreviations && state.abbreviations.size > 0) {
    processed += '\n\n';
    for (const [abbr, title] of state.abbreviations.entries()) {
      processed += `*[${abbr}]: ${title}\n`;
    }
  }

  // Cleanup excessive blank lines (3 or more down to 2)
  processed = processed.replace(/\n{3,}/g, '\n\n');
  
  return processed.trim() + '\n';
}
