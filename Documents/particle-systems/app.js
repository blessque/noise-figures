// p5 instance sketch and simple particle editor
const state = {
  shapes: [], // {type, x, y, w, h} or {type:'path', points: [[x,y],...]} or {type:'svg', paths: [...]}
  particles: [], // {x,y}
  particleCount: 5000,
  particleSize: 1.5,
  color: '#ffffff',
  showGuides: true,
  edgeBias: 0.7,
  edgeFalloff: 3.0,
  currentTool: 'select',
  hoveredIndex: -1,
  selectedIndex: -1,
  interaction: 'none', // 'none'|'drawing'|'moving'|'resizing'
  activeHandle: null, // 'tl'|'tr'|'br'|'bl'
  zoom: 1.0
};

function parseSVGPath(pathData) {
  // Simple SVG path parser - converts path data to point arrays
  const points = [];
  const commands = pathData.match(/[MmLlHhVvCcSsQqTtAaZz][^MmLlHhVvCcSsQqTtAaZz]*/g) || [];
  
  let currentX = 0, currentY = 0;
  let startX = 0, startY = 0;
  
  for (const cmd of commands) {
    const type = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).filter(x => x).map(Number);
    
    switch (type.toLowerCase()) {
      case 'm': // relative move
        currentX += coords[0] || 0;
        currentY += coords[1] || 0;
        if (type === 'M') { startX = currentX; startY = currentY; }
        break;
      case 'l': // relative line
        for (let i = 0; i < coords.length; i += 2) {
          currentX += coords[i] || 0;
          currentY += coords[i + 1] || 0;
          points.push([currentX, currentY]);
        }
        break;
      case 'h': // horizontal line
        currentX += coords[0] || 0;
        points.push([currentX, currentY]);
        break;
      case 'v': // vertical line
        currentY += coords[0] || 0;
        points.push([currentX, currentY]);
        break;
      case 'z': // close path
        if (points.length > 0) points.push([startX, startY]);
        break;
    }
  }
  
  return points.length > 0 ? points : null;
}

function parseSVG(svgText) {
  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
  const svgElement = svgDoc.querySelector('svg');
  
  if (!svgElement) return null;
  
  const paths = [];
  const pathElements = svgElement.querySelectorAll('path');
  
  for (const pathEl of pathElements) {
    const pathData = pathEl.getAttribute('d');
    if (pathData) {
      const points = parseSVGPath(pathData);
      if (points && points.length > 2) {
        paths.push(points);
      }
    }
  }
  
  // Also check for basic shapes
  const rects = svgElement.querySelectorAll('rect');
  for (const rect of rects) {
    const x = parseFloat(rect.getAttribute('x') || 0);
    const y = parseFloat(rect.getAttribute('y') || 0);
    const w = parseFloat(rect.getAttribute('width') || 0);
    const h = parseFloat(rect.getAttribute('height') || 0);
    if (w > 0 && h > 0) {
      paths.push([
        [x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]
      ]);
    }
  }
  
  const circles = svgElement.querySelectorAll('circle');
  for (const circle of circles) {
    const cx = parseFloat(circle.getAttribute('cx') || 0);
    const cy = parseFloat(circle.getAttribute('cy') || 0);
    const r = parseFloat(circle.getAttribute('r') || 0);
    if (r > 0) {
      const points = [];
      for (let i = 0; i < 32; i++) {
        const angle = (i / 32) * Math.PI * 2;
        points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
      }
      paths.push(points);
    }
  }
  
  return paths.length > 0 ? paths : null;
}

function addSVGShapes(svgPaths) {
  if (!svgPaths) return;
  
  for (const pathPoints of svgPaths) {
    if (pathPoints && pathPoints.length > 2) {
      state.shapes.push({
        type: 'svg',
        paths: [pathPoints],
        x: 0, y: 0, w: 0, h: 0 // will be calculated
      });
    }
  }
  
  // Calculate bounds for all SVG shapes
  for (const shape of state.shapes) {
    if (shape.type === 'svg') {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const path of shape.paths) {
        for (const [x, y] of path) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
      shape.x = minX;
      shape.y = minY;
      shape.w = maxX - minX;
      shape.h = maxY - minY;
    }
  }
  
  console.info('SVG imported:', svgPaths.length, 'paths');
}

function generateMaskCanvas(p) {
  const mask = document.createElement('canvas');
  const W = p.width, H = p.height;
  mask.width = W; mask.height = H;
  const mctx = mask.getContext('2d');
  mctx.clearRect(0,0,W,H);
  mctx.fillStyle = '#000'; mctx.fillRect(0,0,W,H);
  mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = '#fff';
  for (const s of state.shapes) {
    if (s.type === 'rect') {
      mctx.fillRect(s.x, s.y, s.w, s.h);
    } else if (s.type === 'ellipse') {
      mctx.beginPath();
      mctx.ellipse(s.x + s.w/2, s.y + s.h/2, Math.abs(s.w/2), Math.abs(s.h/2), 0, 0, Math.PI*2);
      mctx.fill();
    } else if (s.type === 'path' && s.points && s.points.length > 2) {
      mctx.beginPath();
      mctx.moveTo(s.points[0][0], s.points[0][1]);
      for (let i=1;i<s.points.length;i++) mctx.lineTo(s.points[i][0], s.points[i][1]);
      mctx.closePath();
      mctx.fill();
    } else if (s.type === 'svg' && s.paths) {
      for (const pathPoints of s.paths) {
        if (pathPoints && pathPoints.length > 2) {
          mctx.beginPath();
          mctx.moveTo(pathPoints[0][0], pathPoints[0][1]);
          for (let i=1;i<pathPoints.length;i++) {
            mctx.lineTo(pathPoints[i][0], pathPoints[i][1]);
          }
          mctx.closePath();
          mctx.fill();
        }
      }
    }
  }
  return mask;
}

function generateParticles(p) {
  const mask = generateMaskCanvas(p);
  const W = p.width, H = p.height;
  const ctx = mask.getContext('2d');
  const img = ctx.getImageData(0,0,W,H).data;
  // interior distance field (approximate chamfer distance)
  const total = W*H; const INF = 1e9; const dist = new Float32Array(total);
  for (let i=0;i<total;i++) dist[i] = (img[i*4] > 127) ? INF : 0;
  const id = (x,y)=> y*W+x;
  for (let y=0;y<H;y++) {
    for (let x=0;x<W;x++) {
      let d = dist[id(x,y)]; if (d===0) continue;
      if (x>0) d = Math.min(d, dist[id(x-1,y)] + 1);
      if (y>0) d = Math.min(d, dist[id(x,y-1)] + 1);
      if (x>0 && y>0) d = Math.min(d, dist[id(x-1,y-1)] + 1.41421356);
      if (x+1<W && y>0) d = Math.min(d, dist[id(x+1,y-1)] + 1.41421356);
      dist[id(x,y)] = d;
    }
  }
  for (let y=H-1;y>=0;y--) {
    for (let x=W-1;x>=0;x--) {
      let d = dist[id(x,y)]; if (d===0) continue;
      if (x+1<W) d = Math.min(d, dist[id(x+1,y)] + 1);
      if (y+1<H) d = Math.min(d, dist[id(x,y+1)] + 1);
      if (x+1<W && y+1<H) d = Math.min(d, dist[id(x+1,y+1)] + 1.41421356);
      if (x>0 && y+1<H) d = Math.min(d, dist[id(x-1,y+1)] + 1.41421356);
      dist[id(x,y)] = d;
    }
  }

  const want = state.particleCount;
  const result = [];
  const maxConsider = Math.max(W,H) * 0.1; // influence range from edge
  let attempts = 0; const maxAttempts = want * 80;
  while (result.length < want && attempts < maxAttempts) {
    const x = Math.random() * W | 0;
    const y = Math.random() * H | 0;
    const pix = (y*W + x) * 4;
    if (img[pix] > 127) {
      const d = Math.min(dist[id(x,y)], maxConsider);
      const edgeFactor = 1 - (d / maxConsider); // 1 at edge -> 0 toward center
      const accept = state.edgeBias * Math.pow(Math.max(0, edgeFactor), state.edgeFalloff);
      if (Math.random() < accept) result.push({ x, y });
    }
    attempts++;
  }
  if (result.length < want) {
    for (const s of state.shapes) {
      const quota = Math.ceil((want - result.length) / Math.max(state.shapes.length,1));
      for (let i=0;i<quota;i++) {
        const x = s.x + Math.random() * Math.abs(s.w || 1);
        const y = s.y + Math.random() * Math.abs(s.h || 1);
        result.push({ x, y });
        if (result.length >= want) break;
      }
      if (result.length >= want) break;
    }
  }
  state.particles = result;
  console.info('particles generated', result.length);
}

function sketch(p) {
  let dragging = false; let startX=0, startY=0; let currentShape = null;
  p.setup = function() {
    const wrap = document.getElementById('canvas-wrap');
    const rect = wrap.getBoundingClientRect();
    const cnv = p.createCanvas(rect.width, rect.height);
    cnv.parent('canvas-wrap');
    window._p5Instance = p;
  };
  p.windowResized = function() {
    const wrap = document.getElementById('canvas-wrap');
    const rect = wrap.getBoundingClientRect();
    p.resizeCanvas(rect.width, rect.height);
  };
  function screenToWorld(x, y) {
    const cx = p.width/2, cy = p.height/2; const z = state.zoom;
    return { x: (x - cx) / z + cx, y: (y - cy) / z + cy };
  }
  function worldToScreen(x, y) {
    const cx = p.width/2, cy = p.height/2; const z = state.zoom;
    return { x: (x - cx) * z + cx, y: (y - cy) * z + cy };
  }
  function normalizeRectLike(s) {
    if (s.w < 0) { s.x += s.w; s.w = Math.abs(s.w); }
    if (s.h < 0) { s.y += s.h; s.h = Math.abs(s.h); }
  }
  function pointInShape(s, x, y) {
    if (s.type === 'rect') return x>=s.x && y>=s.y && x<=s.x+s.w && y<=s.y+s.h;
    if (s.type === 'ellipse') {
      const cx=s.x+s.w/2, cy=s.y+s.h/2, rx=Math.abs(s.w/2), ry=Math.abs(s.h/2);
      if (!rx || !ry) return false; const dx=(x-cx)/rx, dy=(y-cy)/ry; return dx*dx+dy*dy<=1;
    }
    if (s.type === 'path' && s.points?.length>2) {
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for (const [px,py] of s.points){if(px<minX)minX=px;if(py<minY)minY=py;if(px>maxX)maxX=px;if(py>maxY)maxY=py;} return x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    }
    if (s.type === 'svg') {
      // Simple bbox check for SVG shapes
      return x>=s.x && x<=s.x+s.w && y>=s.y && y<=s.y+s.h;
    }
    return false;
  }
  function getBounds(s){ if(s.type==='path'&&s.points?.length){let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity; for(const [px,py] of s.points){if(px<minX)minX=px;if(py<minY)minY=py;if(px>maxX)maxX=px;if(py>maxY)maxY=py;} return {x:minX,y:minY,w:maxX-minX,h:maxY-minY};} return {x:s.x,y:s.y,w:s.w,h:s.h}; }
  function handleAt(s,mx,my){ if(s.type==='path')return null; const b=getBounds(s); const r=6; const list=[{k:'tl',x:b.x,y:b.y},{k:'tr',x:b.x+b.w,y:b.y},{k:'br',x:b.x+b.w,y:b.y+b.h},{k:'bl',x:b.x,y:b.y+b.h}]; for(const h of list){ if(Math.abs(mx-h.x)<=r && Math.abs(my-h.y)<=r) return h.k; } return null; }

  p.mousePressed = function() {
    if (p.mouseX < 0 || p.mouseY < 0 || p.mouseX > p.width || p.mouseY > p.height) return;
    const tool = state.currentTool; const wm = screenToWorld(p.mouseX, p.mouseY);
    dragging = true; startX = wm.x; startY = wm.y;
    if (tool === 'rect') {
      currentShape = { type: 'rect', x: startX, y: startY, w: 0, h: 0 };
      state.shapes.push(currentShape); state.interaction = 'drawing';
    } else if (tool === 'ellipse') {
      currentShape = { type: 'ellipse', x: startX, y: startY, w: 0, h: 0 };
      state.shapes.push(currentShape); state.interaction = 'drawing';
    } else if (tool === 'path') {
      currentShape = { type: 'path', points: [[startX, startY]] };
      state.shapes.push(currentShape); state.interaction = 'drawing';
    } else if (tool === 'select') {
      state.selectedIndex = -1; state.activeHandle = null; state.interaction = 'none';
      for (let i=state.shapes.length-1;i>=0;i--) {
        const s = state.shapes[i];
        const h = handleAt(s, p.mouseX, p.mouseY);
        if (h) { state.selectedIndex=i; state.activeHandle=h; state.interaction='resizing'; currentShape=s; normalizeRectLike(currentShape); return; }
        if (pointInShape(s, p.mouseX, p.mouseY)) { state.selectedIndex=i; state.interaction='moving'; currentShape=s; normalizeRectLike(currentShape); startX=p.mouseX-currentShape.x; startY=p.mouseY-currentShape.y; return; }
      }
    }
  };
  p.mouseDragged = function() {
    if (!dragging || !currentShape) return;
    const wm = screenToWorld(p.mouseX, p.mouseY);
    if (state.interaction === 'drawing') {
      if (currentShape.type === 'rect' || currentShape.type === 'ellipse') {
        let dx = wm.x - startX; let dy = wm.y - startY;
        if (p.keyIsDown(p.SHIFT)) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx)*m; dy = Math.sign(dy)*m; }
        currentShape.w = dx; currentShape.h = dy;
      } else if (currentShape.type === 'path') { currentShape.points.push([wm.x, wm.y]); }
    } else if (state.interaction === 'moving') {
      currentShape.x = wm.x - startX; currentShape.y = wm.y - startY;
    } else if (state.interaction === 'resizing') {
      const b = getBounds(currentShape); let x0=b.x, y0=b.y, x1=b.x+b.w, y1=b.y+b.h; const k = state.activeHandle;
      if (k==='tl') { x0=wm.x; y0=wm.y; }
      if (k==='tr') { x1=wm.x; y0=wm.y; }
      if (k==='br') { x1=wm.x; y1=wm.y; }
      if (k==='bl') { x0=wm.x; y1=wm.y; }
      let w=x1-x0, h=y1-y0;
      if (p.keyIsDown(p.SHIFT)) {
        const m = Math.max(Math.abs(w), Math.abs(h));
        const sx = (k==='tr'||k==='br')?1:-1; const sy=(k==='bl'||k==='br')?1:-1;
        w = sx*m; h = sy*m;
        if (k==='tl') { x0 = x1 - w; y0 = y1 - h; }
        if (k==='tr') { x1 = x0 + w; y0 = y1 - h; }
        if (k==='br') { x1 = x0 + w; y1 = y0 + h; }
        if (k==='bl') { x0 = x1 - w; y1 = y0 + h; }
      }
      currentShape.x=x0; currentShape.y=y0; currentShape.w=w; currentShape.h=h;
    }
  };
  function smoothPath(points, iterations) {
    // Chaikin's corner cutting
    let pts = points;
    for (let it=0; it<iterations; it++) {
      const out = [];
      for (let i=0;i<pts.length-1;i++) {
        const [x0,y0] = pts[i]; const [x1,y1] = pts[i+1];
        out.push([0.75*x0+0.25*x1, 0.75*y0+0.25*y1]);
        out.push([0.25*x0+0.75*x1, 0.25*y0+0.75*y1]);
      }
      pts = out;
    }
    return pts;
  }

  p.mouseReleased = function() {
    if (currentShape && currentShape.type==='path') {
      const smoothIter = parseInt(document.getElementById('pathSmooth')?.value || '0', 10);
      if (smoothIter > 0 && currentShape.points.length > 2) {
        currentShape.points = smoothPath(currentShape.points, smoothIter);
      }
    }
    if (currentShape && (currentShape.type==='rect'||currentShape.type==='ellipse')) normalizeRectLike(currentShape);
    dragging = false; state.interaction='none'; state.activeHandle=null; currentShape = null; const inst = window._p5Instance; if (inst) generateParticles(inst); setTool('select');
  };
  p.mouseMoved = function() {
    state.hoveredIndex = -1; const wm = screenToWorld(p.mouseX, p.mouseY);
    for (let i=state.shapes.length-1;i>=0;i--) {
      const s = state.shapes[i];
      if (handleAt(s, wm.x, wm.y)) { state.hoveredIndex=i; return; }
      if (pointInShape(s, wm.x, wm.y)) { state.hoveredIndex=i; return; }
    }
  };
  p.draw = function() {
    p.background(10);
    const c = p.canvas; const ctx = c.getContext('2d');
    const cx = p.width/2, cy = p.height/2; p.push(); p.translate(cx, cy); p.scale(state.zoom); p.translate(-cx, -cy);
    p.noStroke(); p.fill(state.color);
    for (let i=0;i<state.particles.length;i++) {
      const pt = state.particles[i];
      p.circle(pt.x, pt.y, state.particleSize);
    }
    if (state.showGuides) {
      for (let i=0;i<state.shapes.length;i++) {
        const s = state.shapes[i];
        const highlighted = (i===state.hoveredIndex)||(i===state.selectedIndex);
        p.noFill(); if (highlighted) { p.stroke(255,204,0); p.strokeWeight(2); } else { p.stroke(255,30); p.strokeWeight(1); }
        if (s.type === 'rect') p.rect(s.x, s.y, s.w, s.h);
        else if (s.type === 'ellipse') p.ellipse(s.x + s.w/2, s.y + s.h/2, Math.abs(s.w), Math.abs(s.h));
        else if (s.type === 'path' && s.points && s.points.length) { p.beginShape(); for (const [x,y] of s.points) p.vertex(x,y); p.endShape(); }
        else if (s.type === 'svg' && s.paths) {
          for (const pathPoints of s.paths) {
            if (pathPoints && pathPoints.length > 2) {
              p.beginShape();
              for (const [x,y] of pathPoints) p.vertex(x,y);
              p.endShape();
            }
          }
        }
        if (i===state.selectedIndex && (s.type==='rect'||s.type==='ellipse')) {
          const b = {x:s.x,y:s.y,w:s.w,h:s.h}; const hr=6; p.noStroke(); p.fill(255,204,0);
          p.square(b.x-hr/2, b.y-hr/2, hr);
          p.square(b.x+b.w-hr/2, b.y-hr/2, hr);
          p.square(b.x+b.w-hr/2, b.y+b.h-hr/2, hr);
          p.square(b.x-hr/2, b.y+b.h-hr/2, hr);
        }
      }
      p.strokeWeight(1);
    }
    p.pop();
  };
}
new p5(sketch, document.getElementById('canvas-wrap'));

// UI wiring
const el = (id) => document.getElementById(id);
// tool buttons
const toolMove = el('toolMove');
const toolRect = el('toolRect');
const toolEllipse = el('toolEllipse');
const toolPath = el('toolPath');
const count = el('count');
const size = el('size');
const color = el('color');
const showShape = el('showShape');
const regen = el('regen');
const clearBtn = el('clear');
const exportPng = el('exportPng');
const exportSvg = el('exportSvg');
const edgeBias = el('edgeBias');
const edgeFalloff = el('edgeFalloff');
const pathSmooth = el('pathSmooth');
const zoomInBtn = el('zoomIn');
const zoomOutBtn = el('zoomOut');
const svgFileInput = el('svgFile');

count.addEventListener('input', () => { state.particleCount = +count.value; el('countVal').textContent = count.value; });
size.addEventListener('input', () => { state.particleSize = +size.value; el('sizeVal').textContent = size.value; });
color.addEventListener('input', () => { state.color = color.value; });
edgeBias.addEventListener('input', () => { state.edgeBias = +edgeBias.value; el('edgeBiasVal').textContent = Number(edgeBias.value).toFixed(2); });
edgeFalloff.addEventListener('input', () => { state.edgeFalloff = +edgeFalloff.value; el('edgeFalloffVal').textContent = Number(edgeFalloff.value).toFixed(1); });
if (pathSmooth) pathSmooth.addEventListener('input', () => { el('pathSmoothVal').textContent = pathSmooth.value; });
function setZoom(z) { state.zoom = Math.max(0.25, Math.min(4, z)); }
zoomInBtn.addEventListener('click', () => setZoom(state.zoom * 1.1));
zoomOutBtn.addEventListener('click', () => setZoom(state.zoom / 1.1));

// SVG file input handling
svgFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file && file.type === 'image/svg+xml') {
    const reader = new FileReader();
    reader.onload = (event) => {
      const svgText = event.target.result;
      const svgPaths = parseSVG(svgText);
      if (svgPaths) {
        addSVGShapes(svgPaths);
        const inst = window._p5Instance;
        if (inst) generateParticles(inst);
      } else {
        alert('Could not parse SVG file. Please ensure it contains valid path elements.');
      }
    };
    reader.readAsText(file);
  }
});

// Drag and drop handling
const canvasWrap = document.getElementById('canvas-wrap');
canvasWrap.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvasWrap.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
});

canvasWrap.addEventListener('dragleave', (e) => {
  e.preventDefault();
  canvasWrap.style.backgroundColor = '';
});

canvasWrap.addEventListener('drop', (e) => {
  e.preventDefault();
  canvasWrap.style.backgroundColor = '';
  
  const files = Array.from(e.dataTransfer.files);
  const svgFiles = files.filter(file => file.type === 'image/svg+xml');
  
  if (svgFiles.length === 0) {
    alert('Please drop SVG files only.');
    return;
  }
  
  svgFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const svgText = event.target.result;
      const svgPaths = parseSVG(svgText);
      if (svgPaths) {
        addSVGShapes(svgPaths);
        const inst = window._p5Instance;
        if (inst) generateParticles(inst);
      }
    };
    reader.readAsText(file);
  });
});
showShape.addEventListener('change', () => { state.showGuides = !!showShape.checked; });
function setTool(tool) {
  state.currentTool = tool;
  // toggle aria-selected
  const btns = [toolMove, toolRect, toolEllipse, toolPath];
  btns.forEach(b => b && b.removeAttribute('aria-selected'));
  if (tool==='select') toolMove.setAttribute('aria-selected','');
  if (tool==='rect') toolRect.setAttribute('aria-selected','');
  if (tool==='ellipse') toolEllipse.setAttribute('aria-selected','');
  if (tool==='path') toolPath.setAttribute('aria-selected','');
  // show/hide path controls
  const pc = el('pathControls');
  if (pc) pc.classList.toggle('hidden', tool!=='path');
}
toolMove.addEventListener('click', () => setTool('select'));
toolRect.addEventListener('click', () => setTool('rect'));
toolEllipse.addEventListener('click', () => setTool('ellipse'));
toolPath.addEventListener('click', () => setTool('path'));
regen.addEventListener('click', () => { const p = window._p5Instance; if (p) generateParticles(p); });
clearBtn.addEventListener('click', () => { state.shapes = []; state.particles = []; });

exportPng.addEventListener('click', () => { const p = window._p5Instance; if (!p) return; p.saveCanvas('particles', 'png'); });

exportSvg.addEventListener('click', () => {
  console.info('export svg started');
  const W = window._p5Instance?.width || 1024; const H = window._p5Instance?.height || 768;
  const s = (p) => { p.setup = () => { p.createCanvas(W, H, p.SVG); p.noStroke(); p.fill(state.color); for (const pt of state.particles) { p.circle(pt.x, pt.y, state.particleSize); } p.save('particles.svg'); setTimeout(() => p.remove(), 0); }; };
  new p5(s);
});

setTimeout(() => { const p = window._p5Instance; if (p) generateParticles(p); }, 300);

export { generateParticles };

// hotkeys: V/Esc select, R rect, O ellipse, P path
window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'v' || key === 'escape') { setTool('select'); }
  else if (key === 'r') { setTool('rect'); }
  else if (key === 'o') { setTool('ellipse'); }
  else if (key === 'p') { setTool('path'); }
  else if (key === '+') { setZoom(state.zoom * 1.1); }
  else if (key === '-') { setZoom(state.zoom / 1.1); }
  else if (key === 'backspace' || key === 'delete') {
    if (state.selectedIndex >= 0) {
      state.shapes.splice(state.selectedIndex, 1);
      state.selectedIndex = -1; state.hoveredIndex = -1;
      const inst = window._p5Instance; if (inst) generateParticles(inst);
      e.preventDefault();
    }
  }
});

