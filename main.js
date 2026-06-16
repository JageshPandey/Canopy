const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// Handle Squirrel installer events
if (process.argv.length >= 2) {
  const cmd = process.argv[1];
  if (['--squirrel-install', '--squirrel-updated', '--squirrel-uninstall', '--squirrel-obsolete'].includes(cmd)) {
    app.quit();
    return;
  }
}

let mainWindow;
let splash;

async function createWindow() {
  splash = new BrowserWindow({
    width: 400,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, 'icon.png')
  });
  splash.loadFile('splash.html');

  mainWindow = new BrowserWindow({
    width: 600,
    height: 480,
    frame: false,
    transparent: true,
    backgroundMaterial: 'mica',
    resizable: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) {
        splash.close();
      }
      mainWindow.show();
    }, 1200);
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window-controls', (event, action) => {
  if (action === 'close') mainWindow.close();
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Fast directory scanner using async fs.promises
async function getFolderThumbnail(dirPath) {
  const validNames = ['cover.jpg', 'cover.png', 'icon.png', 'icon.ico', 'folder.jpg', 'folder.png'];
  for (const name of validNames) {
    const imgPath = path.join(dirPath, name);
    try {
      await fs.access(imgPath);
      // Read as base64
      const data = await fs.readFile(imgPath);
      const ext = path.extname(name).substring(1) || 'jpeg';
      return `data:image/${ext};base64,${data.toString('base64')}`;
    } catch(e) {
      // Ignore
    }
  }
  return null;
}

async function scanDir(dirPath, reportProgress) {
  let scannedCount = 0;
  
  async function traverse(currentPath) {
    let mtime = 0;
    try {
      const selfStats = await fs.stat(currentPath);
      mtime = selfStats.mtimeMs;
    } catch(e) {}

    const node = {
      name: path.basename(currentPath) || currentPath,
      is_dir: true,
      children: [],
      size: 0,
      mtime: mtime,
      thumbnail: await getFolderThumbnail(currentPath)
    };

    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch(e) {
      return node; // Skip unreadable
    }

    const promises = entries.map(async entry => {
      scannedCount++;
      if (scannedCount % 500 === 0) reportProgress(scannedCount, currentPath);

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        const childNode = await traverse(entryPath);
        node.size += childNode.size;
        node.children.push(childNode);
      } else {
        try {
          const stats = await fs.stat(entryPath);
          node.size += stats.size;
          node.children.push({
            name: entry.name,
            is_dir: false,
            size: stats.size,
            mtime: stats.mtimeMs
          });
        } catch(e) {
          // ignore stat errors
        }
      }
    });

    await Promise.all(promises);
    return node;
  }

  return await traverse(dirPath);
}

ipcMain.handle('start-scan', async (event, folderPath) => {
  try {
    const startTime = Date.now();
    let lastProgressTime = 0;
    
    const tree = await scanDir(folderPath, (count, currPath) => {
      const now = Date.now();
      if (now - lastProgressTime > 100) {
        event.sender.send('scan-progress', { count, path: currPath });
        lastProgressTime = now;
      }
    });
    
    tree.name = path.basename(folderPath) || folderPath;

    // Generate HTML
    const templatePath = path.join(__dirname, 'template.html');
    const templateHtml = await fs.readFile(templatePath, 'utf8');
    
    // Inject icon
    const iconPath = path.join(__dirname, 'icon.png');
    let appIconBase64 = '';
    try {
      const iconData = await fs.readFile(iconPath);
      appIconBase64 = `data:image/png;base64,${iconData.toString('base64')}`;
    } catch(e) {}
    
    const jsonTree = JSON.stringify(tree);
    let finalHtml = templateHtml.replace('__TREE_DATA__', jsonTree);
    finalHtml = finalHtml.replace('__APP_ICON__', appIconBase64);
    
    const folderName = path.basename(folderPath);
    const outPath = path.join(folderPath, `${folderName}_canopytree.html`);
    await fs.writeFile(outPath, finalHtml, 'utf8');
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Count stats
    let files = 0, folders = 0, thumbs = 0;
    function countStats(n) {
      if (n.is_dir) folders++; else files++;
      if (n.thumbnail) thumbs++;
      if (n.children) n.children.forEach(countStats);
    }
    countStats(tree);
    
    return {
      success: true,
      stats: { files, folders, thumbs, elapsed },
      outPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
