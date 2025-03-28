const { ipcRenderer } = require('electron');

let isDragging = false;
let startX = 0;
let startY = 0;
const selection = document.getElementById('selection');

ipcRenderer.on('clear-selection', () => {
    if (selection) {
      selection.style.display = 'none';
    }
  });  

document.body.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;
  selection.style.left = `${startX}px`;
  selection.style.top = `${startY}px`;
  selection.style.width = '0px';
  selection.style.height = '0px';
  selection.style.display = 'block';
});

document.body.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);
  selection.style.left = `${x + 1}px`;
  selection.style.top = `${y + 1}px`;
  selection.style.width = `${w}px`;
  selection.style.height = `${h}px`;
});

document.body.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
  
    const region = {
      x: parseInt(selection.style.left),
      y: parseInt(selection.style.top),
      width: parseInt(selection.style.width),
      height: parseInt(selection.style.height)
    };
  
    // Keep selection visible — don't hide it!
    // selection.style.display = 'none'; ❌ (remove or comment out)
  
    ipcRenderer.send('region-selected', region);
  });
  
