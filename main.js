const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const localShortcut = require('electron-localshortcut');

let mainWindow = null;
let stopWindow = null;
let recorderProcess = null;
let currentMKVPath = null;

// Ensure output directory exists
const outputDir = path.join(__dirname, 'clips');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

// Ensure width/height are valid for H264
function roundToEven(n) {
  return n % 2 === 0 ? n : n - 1;
}

// Create drag-select overlay window
function createOverlayWindow() {
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
    mainWindow.setIgnoreMouseEvents(true); // makes overlay "click-through" but still visible

    setTimeout(() => startRecording(region), 200);
  });
}

// Create stop button overlay
function createStopWindow() {
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

// Start recording with FFmpeg (video-only)
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

  console.log('🎬 FFmpeg Command:\n', ffmpegArgs.join(' '));

  recorderProcess = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['pipe', 'inherit', 'inherit']
  });
  

  recorderProcess.on('exit', (code, signal) => {
    console.log(`🛑 FFmpeg exited. Code: ${code}, Signal: ${signal}`);
    console.log(`➡️ MKV path: ${currentMKVPath}`);
  
    recorderProcess = null;
  
    if (stopWindow) {
      stopWindow.close();
      stopWindow = null;
    }
  
    setTimeout(() => {
      const mkvExists = fs.existsSync(currentMKVPath);
      console.log(`📁 MKV exists: ${mkvExists}`);
  
      // Check if the file is large enough (was actually written)
      const stats = fs.existsSync(currentMKVPath) ? fs.statSync(currentMKVPath) : null;
      const fileSize = stats ? stats.size : 0;
  
      if (fileSize > 100000) { // e.g. >100KB
        convertMKVtoMP4(currentMKVPath, outputMP4);
      } else {
        console.log('⚠️ Recording failed or file too small to convert.');
      }
    }, 500); // Wait 500ms for FFmpeg to finalize
  });
  

  createStopWindow();

  // Optional hotkey
  localShortcut.register(mainWindow, 'Control+Shift+S', () => {
    console.log('⛔ Ctrl+Shift+S pressed — stopping recording...');
    stopRecording();
  });
}

// Gracefully stop recording
function stopRecording() {
  if (recorderProcess && recorderProcess.stdin) {
    console.log('🛑 Sending "q" to FFmpeg stdin...');
    recorderProcess.stdin.write('q');
    recorderProcess.stdin.end(); // signal end of input
  }
  

  if (stopWindow) {
    stopWindow.close();
    stopWindow = null;
  }
}

// Convert MKV to MP4 after recording ends
function convertMKVtoMP4(mkvPath, mp4Path) {
  console.log(`🔁 Converting to MP4: ${path.basename(mp4Path)}`);

  const convertProcess = spawn('ffmpeg', [
    '-y',
    '-i', mkvPath,
    '-c', 'copy',
    mp4Path
  ], {
    stdio: ['ignore', 'inherit', 'inherit']
  });

  convertProcess.on('exit', (code) => {
    if (code === 0) {
      console.log(`✅ MP4 saved: ${mp4Path}`);
      fs.unlinkSync(mkvPath);
    } else {
      console.log(`❌ MP4 conversion failed. Exit code: ${code}`);
    }
  });
}

// IPC from stop.html
ipcMain.on('stop-recording', () => {
  stopRecording();
});

// App lifecycle
app.whenReady().then(createOverlayWindow);

app.on('will-quit', () => {
  localShortcut.unregisterAll();
});
