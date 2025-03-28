const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const localShortcut = require('electron-localshortcut');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

const isDev = !app.isPackaged;
const ffmpegPath = isDev
  ? require('@ffmpeg-installer/ffmpeg').path
  : path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe');

let mainWindow = null;
let stopWindow = null;
let tray = null;
let recorderProcess = null;
let currentMKVPath = null;

const outputDir = path.join(app.getPath('videos'), 'ScreenClips');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function roundToEven(n) {
  return n % 2 === 0 ? n : n - 1;
}

function createOverlayWindow() {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }

  mainWindow = new BrowserWindow({
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    fullscreenable: false,
    movable: false,
    show: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.maximize();
  mainWindow.show();
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.loadFile('overlay.html');

  ipcMain.once('region-selected', (event, region) => {
    mainWindow.setIgnoreMouseEvents(true);
    setTimeout(() => startRecording(region), 200);
  });
}

function createStartWindow() {
  if (stopWindow) {
    stopWindow.close();
    stopWindow = null;
  }

  stopWindow = new BrowserWindow({
    width: 120,
    height: 50,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    x: 20,
    y: 20,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  stopWindow.loadFile('start.html');
}

function createStopWindow() {
  if (stopWindow) {
    stopWindow.close();
    stopWindow = null;
  }

  stopWindow = new BrowserWindow({
    width: 120,
    height: 50,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    x: 20,
    y: 20,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  stopWindow.loadFile('stop.html');
}

function startRecording(region) {
  region.width = roundToEven(region.width);
  region.height = roundToEven(region.height);

  if (region.width < 10 || region.height < 10) {
    console.log('❌ Region too small or invalid.');
    return;
  }

  const timestamp = Date.now();
  const mkvName = `clip_${timestamp}.mkv`;
  const mp4Name = `clip_${timestamp}.mp4`;
  currentMKVPath = path.join(outputDir, mkvName);
  const outputMP4 = path.join(outputDir, mp4Name);

  const ffmpegArgs = [
    '-y',
    '-f', 'gdigrab',
    '-framerate', '30',
    '-video_size', `${region.width}x${region.height}`,
    '-offset_x', `${region.x}`,
    '-offset_y', `${region.y}`,
    '-i', 'desktop',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-f', 'matroska',
    currentMKVPath
  ];

  console.log('🎬 FFmpeg Command:', ffmpegPath, ffmpegArgs);
  recorderProcess = spawn(ffmpegPath, ffmpegArgs, {
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true
  });
  

  recorderProcess.on('exit', (code, signal) => {
    console.log(`🛑 FFmpeg exited. Code: ${code}, Signal: ${signal}`);
    recorderProcess = null;

    if (stopWindow) {
      stopWindow.close();
      stopWindow = null;
    }

    if (mainWindow) {
      mainWindow.webContents.send('clear-selection');
    }

    setTimeout(() => {
      const mkvExists = fs.existsSync(currentMKVPath);
      const stats = mkvExists ? fs.statSync(currentMKVPath) : null;
      const fileSize = stats ? stats.size : 0;
      console.log(`📏 File size: ${fileSize} bytes`);

      if (fileSize > 100000) {
        convertMKVtoMP4(currentMKVPath, outputMP4).then(() => {
          createStartWindow();
        });
      } else {
        console.log('⚠️ Recording failed or file too small to convert.');
        createStartWindow();
      }
    }, 500);
  });

  createStopWindow();

  localShortcut.register(mainWindow, 'Control+Shift+S', () => {
    console.log('⛔ Ctrl+Shift+S pressed — stopping recording...');
    stopRecording();
  });
}

function stopRecording() {
  if (recorderProcess && recorderProcess.stdin) {
    console.log('🛑 Sending "q" to FFmpeg stdin...');
    recorderProcess.stdin.write('q');
    recorderProcess.stdin.end();
  }

  if (stopWindow) {
    stopWindow.close();
    stopWindow = null;
  }

  if (mainWindow) {
    mainWindow.webContents.send('clear-selection');
  }
}

function convertMKVtoMP4(mkvPath, mp4Path) {
  console.log(`🔁 Converting to MP4: ${path.basename(mp4Path)}`);

  return new Promise((resolve, reject) => {
    const convertProcess = spawn(ffmpegPath, [
      '-y',
      '-i', mkvPath,
      '-c', 'copy',
      mp4Path
    ], {
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true
    });

    convertProcess.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ MP4 saved: ${mp4Path}`);
        fs.unlinkSync(mkvPath);
        resolve();
      } else {
        console.log(`❌ MP4 conversion failed. Exit code: ${code}`);
        reject();
      }
    });
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.ico');
  tray = new Tray(iconPath);
  const menu = Menu.buildFromTemplate([
    { label: 'Start Recording', click: createOverlayWindow },
    { label: 'Open Clips Folder', click: () => require('electron').shell.openPath(outputDir) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
  tray.setToolTip('Screen Recorder');
  tray.setContextMenu(menu);
}

ipcMain.on('stop-recording', stopRecording);
ipcMain.on('start-recording-flow', createOverlayWindow);

app.whenReady().then(() => {
  createStartWindow();
  createTray();
});

app.on('will-quit', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    localShortcut.unregisterAll();
  }
  
});
