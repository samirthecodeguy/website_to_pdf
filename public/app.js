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
  const views = ['converterView', 'editorView', 'historyView'];
  
  // Update nav link active state
  document.querySelectorAll('.nav-item').forEach(nav => {
    if (nav.getAttribute('href') === `#${viewId.replace('View', '')}`) {
      nav.classList.add('active');
    } else {
      nav.classList.remove('active');
    }
  });

  views.forEach(id => {
    const el = document.getElementById(id);
    if (id === viewId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
};

// Hash Routing
const handleHashChange = () => {
  const hash = window.location.hash || '#convert';
  if (hash === '#history') {
    showView('historyView');
    loadHistory();
  } else if (hash === '#convert') {
    showView('converterView');
  }
};
window.addEventListener('hashchange', handleHashChange);
window.addEventListener('DOMContentLoaded', handleHashChange);

// Global state for current conversion
let currentConversionData = null;

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

    currentConversionData = {
      url: url,
      title: data.metadata?.title || 'Untitled Document',
      markdown: data.markdown,
      images: data.images || []
    };

    // Populate Editor view contents
    docTitle.textContent = currentConversionData.title;
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

// Phase 4 UI Logic: Toast, History, Save

// Toast Notification
const showToast = (message, type = 'success') => {
  const toastContainer = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  
  // Animate in
  requestAnimationFrame(() => toast.classList.add('show'));
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// Directory Picker Modal
const dirPickerModal = document.getElementById('dirPickerModal');
const closeDirPickerBtn = document.getElementById('closeDirPickerBtn');
const cancelDirPickerBtn = document.getElementById('cancelDirPickerBtn');
const confirmSaveBtn = document.getElementById('confirmSaveBtn');
const dirList = document.getElementById('dirList');
const dirBreadcrumbs = document.getElementById('dirBreadcrumbs');
const saveFilename = document.getElementById('saveFilename');
const driveSelect = document.getElementById('driveSelect');

let currentBrowsePath = null;

const openDirPicker = async () => {
  dirPickerModal.style.display = 'flex';
  const defaultFilename = (docTitle.textContent.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'converted') + '.md';
  saveFilename.value = defaultFilename;
  
  // Initial load
  await loadDirectory(null, true);
};

const closeDirPicker = () => {
  dirPickerModal.style.display = 'none';
};

closeDirPickerBtn.addEventListener('click', closeDirPicker);
cancelDirPickerBtn.addEventListener('click', closeDirPicker);

editorSaveBtn.addEventListener('click', () => {
  // Update markdown in case user edited it
  if (currentConversionData) {
    currentConversionData.markdown = markdownEditor.value;
  }
  openDirPicker();
});

const loadDirectory = async (dirPath = null, getDrives = false) => {
  try {
    const res = await fetch('/api/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dirPath, getDrives })
    });
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error?.message || 'Failed to load directory');
    
    if (getDrives && data.drives) {
      if (data.drives.length > 1) {
        driveSelect.style.display = 'block';
        driveSelect.innerHTML = data.drives.map(d => `<option value="${d}">${d}</option>`).join('');
      } else {
        driveSelect.style.display = 'none';
      }
      currentBrowsePath = data.defaultDir;
      await loadDirectory(currentBrowsePath, false);
      return;
    }
    
    currentBrowsePath = data.path;
    renderDirPicker(data);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

driveSelect.addEventListener('change', (e) => {
  loadDirectory(e.target.value, false);
});

const renderDirPicker = (data) => {
  // Breadcrumbs
  const parts = data.path.split(/[\/\\]/).filter(Boolean);
  let html = `<span class="crumb" data-path="/">/</span>`;
  let currentAccumulatedPath = data.path.startsWith('/') ? '' : (data.path.split(/[\/\\]/)[0] + '\\'); // basic windows handling
  
  parts.forEach((part, i) => {
    const isWin = data.path.includes('\\');
    const sep = isWin ? '\\' : '/';
    if (i === 0 && isWin && part.endsWith(':')) {
       currentAccumulatedPath = part + sep;
    } else {
       currentAccumulatedPath += (currentAccumulatedPath.endsWith(sep) ? '' : sep) + part;
    }
    html += `<span class="crumb-separator">›</span><span class="crumb" data-path="${currentAccumulatedPath}">${part}</span>`;
  });
  dirBreadcrumbs.innerHTML = html;
  
  // Clickable breadcrumbs
  dirBreadcrumbs.querySelectorAll('.crumb').forEach(crumb => {
    crumb.addEventListener('click', () => loadDirectory(crumb.dataset.path, false));
  });
  
  // List
  dirList.innerHTML = '';
  if (data.parent) {
    const upBtn = document.createElement('div');
    upBtn.className = 'dir-item';
    upBtn.innerHTML = `📁 .. (Go Up)`;
    upBtn.addEventListener('click', () => loadDirectory(data.parent, false));
    dirList.appendChild(upBtn);
  }
  
  data.directories.forEach(dir => {
    const el = document.createElement('div');
    el.className = 'dir-item';
    el.innerHTML = `📁 ${dir.name}`;
    el.addEventListener('click', () => loadDirectory(dir.path, false));
    dirList.appendChild(el);
  });
};

// Confirm Save
confirmSaveBtn.addEventListener('click', async () => {
  if (!currentConversionData || !currentBrowsePath) return;
  
  confirmSaveBtn.disabled = true;
  confirmSaveBtn.textContent = 'Saving...';
  
  try {
    const payload = {
      markdown: currentConversionData.markdown,
      images: currentConversionData.images,
      savePath: currentBrowsePath,
      filename: saveFilename.value,
      url: currentConversionData.url,
      title: currentConversionData.title
    };
    
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Failed to save');
    
    showToast('Saved successfully!', 'success');
    closeDirPicker();
    window.location.hash = '#history';
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    confirmSaveBtn.disabled = false;
    confirmSaveBtn.textContent = 'Save Here';
  }
});

// History Logic
const loadHistory = async () => {
  const historyGrid = document.getElementById('historyGrid');
  if (!historyGrid) return;
  historyGrid.innerHTML = '<div class="loading-text">Loading history...</div>';
  
  try {
    const res = await fetch('/api/history');
    const entries = await res.json();
    
    if (entries.length === 0) {
      historyGrid.innerHTML = '<div class="empty-state">No conversion history yet.</div>';
      return;
    }
    
    historyGrid.innerHTML = entries.map(entry => `
      <div class="history-card glass-card">
        <div class="card-header">
          <span class="status-badge status-${entry.status}">${entry.status}</span>
          <button class="icon-btn delete-btn" data-id="${entry.id}" aria-label="Delete entry">🗑️</button>
        </div>
        <h3 class="card-title">${escapeHtml(entry.title)}</h3>
        <a href="${escapeHtml(entry.url)}" target="_blank" class="card-url">${escapeHtml(entry.url)}</a>
        <div class="card-meta">
          <span>📅 ${new Date(entry.date).toLocaleDateString()}</span>
          <span>🖼️ ${entry.imageCount} images</span>
        </div>
        <div class="card-path">💾 ${escapeHtml(entry.savePath + '/' + entry.filename)}</div>
      </div>
    `).join('');
    
    // Add delete listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        if (confirm('Delete this history entry?')) {
          await deleteHistory(id);
          loadHistory(); // Reload
        }
      });
    });
  } catch (err) {
    historyGrid.innerHTML = `<div class="error-text">Failed to load history: ${err.message}</div>`;
  }
};

const deleteHistory = async (id) => {
  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    showToast('Entry deleted');
  } catch (err) {
    showToast(err.message, 'error');
  }
};

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
