const { ipcRenderer } = require('electron');

lucide.createIcons();

// Window Controls
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('window-controls', 'close'));
document.getElementById('btn-min').addEventListener('click', () => ipcRenderer.send('window-controls', 'minimize'));
document.getElementById('btn-max').addEventListener('click', () => ipcRenderer.send('window-controls', 'maximize'));

// State Management
function setState(stateId) {
  document.querySelectorAll('.state-view').forEach(el => el.classList.remove('active'));
  document.getElementById(stateId).classList.add('active');
}

// Drag & Drop
document.body.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.body.addEventListener('dragleave', (e) => { e.preventDefault(); document.body.classList.remove('drag-over'); });
document.body.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  if (e.dataTransfer.files.length > 0) {
    const path = e.dataTransfer.files[0].path;
    startScan(path);
  }
});

let currentOutPath = '';

// Actions
document.getElementById('btn-choose').addEventListener('click', async () => {
  const path = await ipcRenderer.invoke('select-folder');
  if (path) startScan(path);
});

document.getElementById('btn-another').addEventListener('click', () => setState('state-idle'));
document.getElementById('btn-retry').addEventListener('click', () => setState('state-idle'));

document.getElementById('btn-open').addEventListener('click', () => {
  // Use electron shell to open the file
  require('electron').shell.openPath(currentOutPath);
});

async function startScan(folderPath) {
  setState('state-scanning');
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('ticker').innerText = 'Initializing...';

  const result = await ipcRenderer.invoke('start-scan', folderPath);
  
  if (result.success) {
    currentOutPath = result.outPath;
    document.getElementById('stats-text').innerText = 
      `✅ ${result.stats.files} files • ${result.stats.folders} folders • ${result.stats.thumbs} thumbnails • ${result.stats.elapsed}s`;
    document.getElementById('saved-path-text').innerText = result.outPath;
    
    // Save to recents
    let recents = JSON.parse(localStorage.getItem('canopy_recents') || '[]');
    const folderName = folderPath.split('\\').pop() || folderPath.split('/').pop() || folderPath;
    recents = recents.filter(r => r.path !== folderPath);
    recents.unshift({ name: folderName, path: folderPath });
    if (recents.length > 5) recents.pop();
    localStorage.setItem('canopy_recents', JSON.stringify(recents));
    renderRecents();
    
    setState('state-complete');
    triggerConfetti();
  } else {
    document.getElementById('error-msg').innerText = result.error;
    setState('state-error');
  }
}

ipcRenderer.on('scan-progress', (event, data) => {
  document.getElementById('ticker').innerText = data.path;
  // Faux progress bar that approaches 90% then waits
  const currentWidth = parseFloat(document.getElementById('progress-bar').style.width || '0');
  const newWidth = currentWidth + (90 - currentWidth) * 0.1;
  document.getElementById('progress-bar').style.width = `${newWidth}%`;
});

function triggerConfetti() {
  confetti({
    particleCount: 60,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#0f766e', '#10b981', '#ffffff']
  });
}

function renderRecents() {
  const container = document.getElementById('recent-files');
  if (!container) return;
  const recents = JSON.parse(localStorage.getItem('canopy_recents') || '[]');
  container.innerHTML = recents.length ? `<span style="margin-right:4px;">Recent:</span>` : '';
  recents.forEach(r => {
    const chip = document.createElement('div');
    chip.className = 'recent-chip';
    chip.innerHTML = `<i data-lucide="folder" style="width:12px;height:12px;"></i> ${r.name}`;
    chip.onclick = () => startScan(r.path);
    container.appendChild(chip);
  });
  lucide.createIcons({root: container});
}

renderRecents();
