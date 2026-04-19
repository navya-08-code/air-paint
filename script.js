// Elements
const videoElement = document.querySelector('.input_video');
const canvasElement = document.querySelector('.output_canvas');
const canvasCtx = canvasElement.getContext('2d');
const drawingCanvas = document.createElement('canvas');
const dCtx = drawingCanvas.getContext('2d');
const onboarding = document.getElementById('onboarding');
const startBtn = document.getElementById('start-btn');
const loadingSpinner = document.getElementById('loading-spinner');

// HUD
const fpsCounter = document.getElementById('fps-counter');
const handStatus = document.getElementById('hand-status');
const currentGestureLabel = document.getElementById('current-gesture');

// State
let width, height;
let currentColor = '#ff00ff';
let currentBrush = 'neon';
let currentSize = 10;
let paths = []; // Array of { points: [{x,y}], color, size, brush }
let currentPath = null;
let redoStack = [];
let particles = [];

// Gesture State
let isDrawing = false;
let isPinching = false;
let lastPinchDist = 0;
let lastIndexPos = null;

// FPS calculation
let lastTime = performance.now();
let frameCount = 0;

// Resize canvas
function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvasElement.width = width;
    canvasElement.height = height;
    drawingCanvas.width = width;
    drawingCanvas.height = height;
    // Because canvas is mirrored in CSS, we need to handle drawing accordingly
    // We will mirror the X coordinates of landmarks instead of mirroring the canvas context
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- Particle System ---
class Particle {
    constructor(x, y, color, size) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = Math.random() * size + 2;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.life = 1.0;
        this.decay = Math.random() * 0.02 + 0.01;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }
    draw(ctx) {
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
    }
}

// --- Drawing System ---
function drawPaths() {
    dCtx.clearRect(0, 0, width, height);
    paths.forEach(p => renderPath(p));
    if (currentPath) renderPath(currentPath);

    // Update and Draw Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.update();
        p.draw(dCtx);
        if (p.life <= 0) particles.splice(i, 1);
    }

    canvasCtx.drawImage(drawingCanvas, 0, 0);
}

function renderPath(path) {
    if (path.points.length < 2) return;
    
    dCtx.beginPath();
    dCtx.lineCap = 'round';
    dCtx.lineJoin = 'round';
    dCtx.lineWidth = path.size;
    
    if (path.brush === 'eraser') {
        dCtx.globalCompositeOperation = 'destination-out';
        dCtx.strokeStyle = 'rgba(0,0,0,1)';
        dCtx.shadowBlur = 0;
    } else {
        dCtx.globalCompositeOperation = 'source-over';
        if (path.brush === 'neon') {
            dCtx.strokeStyle = '#ffffff';
            dCtx.shadowBlur = 20;
            dCtx.shadowColor = path.color;
        } else if (path.brush === 'soft') {
            dCtx.strokeStyle = path.color;
            dCtx.globalAlpha = 0.5;
            dCtx.shadowBlur = 30;
            dCtx.shadowColor = path.color;
        } else {
            dCtx.strokeStyle = path.color;
            dCtx.shadowBlur = 0;
        }
    }

    // Bezier Curve Interpolation for smooth lines
    dCtx.moveTo(path.points[0].x, path.points[0].y);
    for (let i = 1; i < path.points.length - 1; i++) {
        let xc = (path.points[i].x + path.points[i+1].x) / 2;
        let yc = (path.points[i].y + path.points[i+1].y) / 2;
        dCtx.quadraticCurveTo(path.points[i].x, path.points[i].y, xc, yc);
    }
    // curve through the last two points
    let lastPoint = path.points[path.points.length - 1];
    let secondLastPoint = path.points[path.points.length - 2];
    dCtx.quadraticCurveTo(secondLastPoint.x, secondLastPoint.y, lastPoint.x, lastPoint.y);
    
    dCtx.stroke();
    dCtx.globalAlpha = 1.0; // reset
    dCtx.shadowBlur = 0;
    dCtx.globalCompositeOperation = 'source-over';
}

function addPoint(x, y) {
    if (!currentPath) {
        currentPath = { points: [], color: currentColor, size: currentSize, brush: currentBrush };
    }
    
    // Simple smoothing: only add point if distance from last is > min_dist
    if (currentPath.points.length > 0) {
        const lastPt = currentPath.points[currentPath.points.length - 1];
        const dist = Math.hypot(x - lastPt.x, y - lastPt.y);
        if (dist < 5) return;
    }
    
    currentPath.points.push({x, y});
    
    if (currentBrush === 'particle') {
        for (let i = 0; i < 3; i++) {
            particles.push(new Particle(x, y, currentColor, currentSize));
        }
    }
}

// --- Gesture Detection ---
function getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function onResults(results) {
    // Update FPS
    let now = performance.now();
    frameCount++;
    if (now - lastTime >= 1000) {
        fpsCounter.innerText = frameCount;
        frameCount = 0;
        lastTime = now;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw Video Feed (with optional darkening filter applied via globalAlpha)
    canvasCtx.globalAlpha = 0.4; // make background darker so neon pops
    // Note: CSS scaleX(-1) mirrors the canvas visually, so we draw normal video here but it appears mirrored to user.
    // Wait, MediaPipe results are normalized (0-1). If CSS mirrors the canvas, the coordinate system is visually flipped.
    // X=0 is actually right side of screen. 
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    canvasCtx.globalAlpha = 1.0;

    let currentGesture = 'Idle';

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        handStatus.innerText = "Tracking";
        handStatus.className = "hud-value neon-cyan";

        const landmarks = results.multiHandLandmarks[0];
        
        // Convert to canvas coordinates. 
        // Because CSS mirrors the canvas (scaleX(-1)), if we want the drawing to track the hand exactly on the screen,
        // we must draw at the exact normalized coordinates, because the video is also mirrored by CSS.
        // Actually, MediaPipe camera input is mirrored by default in many configs, let's just use raw coords.
        const indexTip = landmarks[8];
        const thumbTip = landmarks[4];
        
        let ix = indexTip.x * width;
        let iy = indexTip.y * height;
        let tx = thumbTip.x * width;
        let ty = thumbTip.y * height;

        // Draw cursor at index tip
        canvasCtx.beginPath();
        canvasCtx.arc(ix, iy, currentSize / 2 + 5, 0, 2 * Math.PI);
        canvasCtx.strokeStyle = currentColor;
        canvasCtx.lineWidth = 2;
        canvasCtx.stroke();

        // Check fingers state for Eraser Gesture (Peace sign: Index & Middle up, Ring & Pinky down)
        const indexExtended = landmarks[8].y < landmarks[6].y;
        const middleExtended = landmarks[12].y < landmarks[10].y;
        const ringClosed = landmarks[16].y > landmarks[14].y;
        const pinkyClosed = landmarks[20].y > landmarks[18].y;
        const isEraserGesture = indexExtended && middleExtended && ringClosed && pinkyClosed;

        // Check Pinch (Distance between thumb and index tip)
        let pinchDist = getDistance({x: ix, y: iy}, {x: tx, y: ty});
        let threshold = 0.05 * width; // 5% of screen width

        if (isEraserGesture) {
            currentGesture = 'Erasing (Peace)';
            if (!isDrawing) {
                isDrawing = true;
                // Force brush to 'eraser', but size larger for easier erasing
                currentPath = { points: [], color: '#000', size: currentSize * 2, brush: 'eraser', isEraserGesture: true };
            }
            
            // Midpoint of index and middle for eraser cursor
            let mx = (landmarks[8].x + landmarks[12].x) / 2 * width;
            let my = (landmarks[8].y + landmarks[12].y) / 2 * height;
            
            canvasCtx.beginPath();
            canvasCtx.arc(mx, my, currentSize + 5, 0, 2 * Math.PI);
            canvasCtx.strokeStyle = '#fff';
            canvasCtx.setLineDash([5, 5]);
            canvasCtx.lineWidth = 2;
            canvasCtx.stroke();
            canvasCtx.setLineDash([]);
            
            addPoint(mx, my);
            
        } else if (pinchDist < threshold) {
            currentGesture = 'Drawing (Pinch)';
            if (!isDrawing) {
                // Start drawing
                isDrawing = true;
                currentPath = { points: [], color: currentColor, size: currentSize, brush: currentBrush };
            }
            // If they switched from eraser gesture to pinch directly
            if (currentPath && currentPath.isEraserGesture) {
                paths.push(currentPath);
                currentPath = { points: [], color: currentColor, size: currentSize, brush: currentBrush };
            }
            addPoint(ix, iy);
        } else {
            if (isDrawing) {
                // Stop drawing
                isDrawing = false;
                if (currentPath && currentPath.points.length > 0) {
                    paths.push(currentPath);
                    redoStack = []; // clear redo on new draw
                }
                currentPath = null;
            }
            
            // Swipe Detection (Open hand moving fast)
            // If hand open (fingers extended) and moves horizontally fast
            if (lastIndexPos && !isDrawing) {
                let dx = ix - lastIndexPos.x;
                if (Math.abs(dx) > width * 0.1) { // 10% screen swipe per frame is very fast
                    currentGesture = 'Swipe ' + (dx > 0 ? 'Right' : 'Left');
                    // We could trigger color change here, but needs debounce
                }
            }
        }
        
        lastIndexPos = {x: ix, y: iy};

    } else {
        handStatus.innerText = "No Hand";
        handStatus.className = "hud-value neon-pink";
        if (isDrawing) {
            isDrawing = false;
            if (currentPath && currentPath.points.length > 0) paths.push(currentPath);
            currentPath = null;
        }
    }

    currentGestureLabel.innerText = currentGesture;

    // Draw previous paths
    drawPaths();

    // Particles are now drawn inside drawPaths


    canvasCtx.restore();
}

// --- Initialization ---
const hands = new Hands({locateFile: (file) => {
  return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
}});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});
hands.onResults(onResults);

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({image: videoElement});
  },
  width: 1280,
  height: 720
});

// UI Event Listeners
startBtn.addEventListener('click', () => {
    onboarding.style.opacity = '0';
    setTimeout(() => {
        onboarding.style.display = 'none';
        camera.start();
    }, 500);
});

// simulate loaded when library executes (we don't have perfect hook for model loaded, but good enough)
setTimeout(() => {
    loadingSpinner.style.display = 'none';
    startBtn.style.display = 'inline-block';
}, 2000);

// Colors
document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentColor = e.target.dataset.color;
    });
});

// Brush
document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentBrush = e.target.dataset.brush;
    });
});

// Size
const sizeSlider = document.getElementById('brush-size');
const sizeVal = document.getElementById('size-val');
sizeSlider.addEventListener('input', (e) => {
    currentSize = parseInt(e.target.value);
    sizeVal.innerText = currentSize;
});

// Actions
document.getElementById('btn-clear').addEventListener('click', () => {
    paths = [];
    redoStack = [];
    particles = [];
});

document.getElementById('btn-undo').addEventListener('click', () => {
    if (paths.length > 0) {
        redoStack.push(paths.pop());
    }
});

document.getElementById('btn-save').addEventListener('click', () => {
    // To save just the drawing, we need to re-render without video background
    // For simplicity, we just save the current canvas state (which includes video if drawn)
    // To make it look clean, we draw on a temporary canvas without the video
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tCtx = tempCanvas.getContext('2d');
    
    // Background
    tCtx.fillStyle = '#05050a';
    tCtx.fillRect(0, 0, width, height);
    
    // Since output is mirrored by CSS, the image data is mirrored visually but actual pixels are regular.
    // If we want the saved image to look exactly like the screen, we must mirror context.
    tCtx.translate(width, 0);
    tCtx.scale(-1, 1);

    // Draw the pre-rendered drawingCanvas directly!
    tCtx.drawImage(drawingCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'virtual-air-painter.png';
    link.href = tempCanvas.toDataURL('image/png');
    link.click();
});
