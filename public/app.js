// Theme Manager
const themeToggle = document.getElementById('themeToggle');

const getPreferredTheme = () => {
  const storedTheme = localStorage.getItem('theme');
  if (storedTheme) return storedTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const setTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
};

// Initialize Theme
setTheme(getPreferredTheme());

themeToggle.addEventListener('click', () => {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  setTheme(newTheme);
});

// Navigation Views
const showView = (viewId) => {
  const views = ['converterView', 'editorView'];
  views.forEach(id => {
    const el = document.getElementById(id);
    if (id === viewId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
};

// Convert Flow
const convertForm = document.getElementById('convertForm');
const urlInput = document.getElementById('urlInput');
const convertSubmitBtn = document.getElementById('convertSubmitBtn');
const errorMessage = document.getElementById('errorMessage');
const loadingState = document.getElementById('loadingState');

// Editor Pane references
const docTitle = document.getElementById('docTitle');
const docSource = document.getElementById('docSource');
const markdownEditor = document.getElementById('markdownEditor');
const markdownPreview = document.getElementById('markdownPreview');
const editorBackBtn = document.getElementById('editorBackBtn');
const editorSaveBtn = document.getElementById('editorSaveBtn');

// Helper to escape HTML safely for textual output error messages
const escapeHtml = (text) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
};

const showError = (msg) => {
  errorMessage.textContent = escapeHtml(msg);
  errorMessage.style.display = 'block';
};

const hideError = () => {
  errorMessage.style.display = 'none';
  errorMessage.textContent = '';
};

// Debounce preview rendering
let debounceTimer;
const debounce = (callback, delay) => {
  return (...args) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => callback(...args), delay);
  };
};

const renderPreview = () => {
  const mdText = markdownEditor.value;
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    const rawHtml = marked.parse(mdText);
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    markdownPreview.innerHTML = cleanHtml;
  } else {
    // Fallback if CDN failed
    markdownPreview.textContent = mdText;
  }
};

markdownEditor.addEventListener('input', debounce(renderPreview, 150));

convertForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  // Simple validation
  try {
    new URL(url);
  } catch (_) {
    showError('Please enter a valid absolute URL, including http:// or https://');
    return;
  }

  // Reset UI states
  hideError();
  convertSubmitBtn.disabled = true;
  convertSubmitBtn.classList.add('loading');
  loadingState.style.display = 'block';

  try {
    const response = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to convert website content.');
    }

    // Populate Editor view contents
    docTitle.textContent = data.metadata?.title || 'Untitled Document';
    docSource.textContent = data.metadata?.source || url;
    markdownEditor.value = data.markdown;
    
    // Render the initial preview pane contents
    renderPreview();
    
    // Switch views
    showView('editorView');
  } catch (err) {
    showError(err.message);
  } finally {
    convertSubmitBtn.disabled = false;
    convertSubmitBtn.classList.remove('loading');
    loadingState.style.display = 'none';
  }
});

// Editor Back Navigation
editorBackBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to go back? Unsaved changes in the editor will be lost.')) {
    showView('converterView');
    urlInput.value = '';
    hideError();
  }
});

// Save Button browser download fallback
editorSaveBtn.addEventListener('click', () => {
  const markdownText = markdownEditor.value;
  const title = docTitle.textContent.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'converted';
  const blob = new Blob([markdownText], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Draggable Split Pane Resizer
const resizer = document.getElementById('paneResizer');
const leftPane = document.getElementById('leftPane');
const rightPane = document.getElementById('rightPane');
const splitPane = document.getElementById('splitPane');

let isDragging = false;

const startResize = () => {
  isDragging = true;
  resizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
};

const stopResize = () => {
  if (isDragging) {
    isDragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
  }
};

const resize = (clientX) => {
  if (!isDragging) return;
  const splitPaneRect = splitPane.getBoundingClientRect();
  const percentage = ((clientX - splitPaneRect.left) / splitPaneRect.width) * 100;
  if (percentage > 15 && percentage < 85) {
    leftPane.style.width = `${percentage}%`;
  }
};

// Mouse listeners
resizer.addEventListener('mousedown', startResize);
document.addEventListener('mousemove', (e) => resize(e.clientX));
document.addEventListener('mouseup', stopResize);

// Touch listeners (mobile/tablet fallback)
resizer.addEventListener('touchstart', startResize);
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 0) {
    resize(e.touches[0].clientX);
  }
});
document.addEventListener('touchend', stopResize);
