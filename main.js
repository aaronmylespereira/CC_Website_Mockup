import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Basic Setup ---
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvas,
    alpha: true // Enable alpha for transparency
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// renderer.outputColorSpace = THREE.SRGBColorSpace; // Often needed, uncomment if colors look wrong

const scene = new THREE.Scene();
// scene.background = new THREE.Color(0); // Using starfield instead

// --- Browser Detection ---
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
// Check for iOS specifically for touch handling, though this might capture iPadOS too
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
console.log(`Browser detection: ${isSafari ? 'Safari' : 'Not Safari'}, ${isIOS ? 'iOS' : 'Not iOS'}`);

// --- DOM Elements ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingProgressElement = document.getElementById('loading-progress');
const audioUnlockButton = document.getElementById('audio-unlock-button');
const infoPanelElement = document.getElementById('info-panel');

// --- Canvas Video Texture Helper (for Safari HEVC Alpha) ---
function createCanvasVideoTexture(videoPath, onTextureReady) {
    // Create video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.src = videoPath;

    // Create a canvas to draw the video frames
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: true }); // Ensure alpha channel for context

    // Set initial size - will be updated when video loads
    canvas.width = 512;
    canvas.height = 512;

    // Create a texture from the canvas
    const canvasTexture = new THREE.CanvasTexture(canvas);
    canvasTexture.format = THREE.RGBAFormat; // Use RGBA for transparency
    canvasTexture.minFilter = THREE.LinearFilter;
    canvasTexture.magFilter = THREE.LinearFilter;
    canvasTexture.generateMipmaps = false;
    canvasTexture.flipY = false; // ** CRITICAL FIX for rotation issue ** Match GLTF standard

    // Function to update the canvas with video frames
    let animationFrameId = null; // To potentially cancel updates if needed
    function updateCanvasTexture() {
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
            // Resize canvas if needed (only if dimensions actually change)
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                if (video.videoWidth > 0 && video.videoHeight > 0) { // Ensure valid dimensions
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    // console.log(`Resized canvas texture for ${videoPath} to ${canvas.width}x${canvas.height}`); // Less verbose logging
                }
            }

            // Draw video frame to canvas, preserving transparency
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Mark texture for update
            canvasTexture.needsUpdate = true;
        }

        // Continue updating in animation loop
        animationFrameId = requestAnimationFrame(updateCanvasTexture);
    }

    // Start updates when video is ready
    video.addEventListener('loadedmetadata', () => {
        // console.log(`Video dimensions for ${videoPath}: ${video.videoWidth}x${video.videoHeight}`); // Less verbose logging
        // Ensure dimensions are valid before setting canvas size
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        } else {
             console.warn(`Video ${videoPath} loaded metadata but reported invalid dimensions (0x0). Using default canvas size.`);
        }
        // Play video - might require user interaction if not muted, but these are muted
        video.play().catch(e => {
             // Ignore AbortError which can happen if play/pause is rapid
             if (e.name !== 'AbortError') {
                 console.error(`Error trying to play video ${videoPath} initially:`, e);
             }
        });
        updateCanvasTexture(); // Start the canvas drawing loop

        if (onTextureReady) {
            onTextureReady(canvasTexture, video);
        }
    });

    // Handle errors
    video.addEventListener('error', (e) => {
        console.error(`Error loading or playing video: ${videoPath}`, e);
        // Optionally cancel the update loop on error
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
    });

    return {
        texture: canvasTexture,
        video: video,
        canvas: canvas,
        update: updateCanvasTexture,
        // Add a cleanup function
        dispose: () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            video.pause();
            video.removeAttribute('src'); // Release resource
            video.load(); // Reset element state
            canvasTexture.dispose();
            console.log(`Disposed canvas texture resources for ${videoPath}`);
        }
    };
}

// --- Loading Manager ---
const loadingManager = new THREE.LoadingManager();

loadingManager.onStart = function ( url, itemsLoaded, itemsTotal ) {
    console.log( `Started loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.` );
    loadingProgressElement.textContent = `Loading... 0%`; // Reset progress text
    audioUnlockButton.style.display = 'none'; // Ensure button is hidden during loading
};

loadingManager.onLoad = function ( ) {
    console.log( 'Loading complete!');
    loadingProgressElement.textContent = 'Loading complete!';
    setTimeout(() => {
        loadingProgressElement.style.display = 'none';
        audioUnlockButton.style.display = 'block';
    }, 500);
};

loadingManager.onProgress = function ( url, itemsLoaded, itemsTotal ) {
    // console.log( `Loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.` ); // Less verbose
    const progress = Math.round((itemsLoaded / itemsTotal * 100));
    loadingProgressElement.textContent = `Loading... ${progress}%`;
};

loadingManager.onError = function ( url ) {
    console.error( 'There was an error loading ' + url );
    loadingProgressElement.textContent = `Error loading: ${url}`;
    audioUnlockButton.style.display = 'none';
};


// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(5, 10, 7.5).normalize();
scene.add(directionalLight);

// --- Starry Background ---
let starMaterial;
const starCount = 50000;
const starVertices = [];
const starGeometry = new THREE.BufferGeometry();

for (let i = 0; i < starCount; i++) {
    const theta = THREE.MathUtils.randFloatSpread(360); const phi = THREE.MathUtils.randFloatSpread(360);
    const radius = THREE.MathUtils.randFloat(50, 150); // Adjusted radius for potentially wider view
    const x = radius * Math.sin(theta) * Math.cos(phi); const y = radius * Math.sin(theta) * Math.sin(phi); const z = radius * Math.cos(theta);
    starVertices.push(x, y, z);
}
starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.85 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);


// --- GLTF Loading ---
const loader = new GLTFLoader(loadingManager);
let importedCamera;

const modelPath = 'assets/MockupWebsite_webm_noBackground.glb';
const backgroundSoundPath = 'assets/MixStereo.wav';

// --- Video Plane Setup ---
const videoPlanes = [ 'lanternBugfly_webm', 'lunaMoth_webm', 'tigerButterfly_webm' ];

// Define video paths - ** Includes Safari HEVC and Default WebM for all **
const videoFileMap = {
    'lanternBugfly_webm': {
        safari: 'assets/lanternBugfly_H.265.mov', // Make sure this path is correct
        default: 'assets/lanternBugfly_webm.webm'
    },
    'lunaMoth_webm': {
        safari: 'assets/Luna_Moth_H.265.mov',
        default: 'assets/Luna_Moth.webm'
    },
    'tigerButterfly_webm': {
        safari: 'assets/tigerButterfly_H.265.mov', // Make sure this path is correct
        default: 'assets/tigerButterfly_webm.webm'
    }
};

// Store video/texture objects
const canvasTextureObjects = {}; // Only for Safari HEVC
const videoElements = {}; // Store all video elements by mesh name
const videoMeshes = []; // Store meshes that have videos applied
let currentlyHoveredVideo = null;

// --- Info Panel Setup ---
const infoPanelData = {
    'lanternBugfly_webm': 'This is the Lantern Bugfly. It glows gently in the dark.',
    'lunaMoth_webm': 'The Luna Moth, known for its ethereal beauty and large wings.',
    'tigerButterfly_webm': 'A Tiger Butterfly, showcasing vibrant patterns.'
};
const infoPanelOffset = { x: 15, y: -15 };

// --- Raycasting Setup ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(-2, -2); // Initialize off-screen

// --- Movement Setup ---
const clock = new THREE.Clock();
const moveSpeed = 3.0;
const scrollSensitivity = 0.01;
const touchScrollSensitivity = 0.01;
const scrollDamping = 0.75;

// ** Clamping Bounds **
const minCameraX = -50; const maxCameraX = 50;
const minCameraZ = -1.75; const maxCameraZ = 1.75;

const keyStates = { W: false, A: false, S: false, D: false };
let scrollVelocityX = 0;
let isCameraLoaded = false;
let sceneReady = false;

// --- Audio Setup ---
let listener;
let backgroundSound;
let audioContextResumed = false;

// --- Touch State ---
let touchStartY = 0;
let isTouching = false;

// --- Event Listeners ---
// Keyboard Listeners
document.addEventListener('keydown', (event) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) { event.preventDefault(); }
    switch (event.code) {
        case 'KeyW': keyStates.W = true; break; case 'KeyA': keyStates.A = true; break;
        case 'KeyS': keyStates.S = true; break; case 'KeyD': keyStates.D = true; break;
    }
});
document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': keyStates.W = false; break; case 'KeyA': keyStates.A = false; break;
        case 'KeyS': keyStates.S = false; break; case 'KeyD': keyStates.D = false; break;
    }
});

// Mouse Wheel Listener
window.addEventListener('wheel', (event) => {
    if (!isCameraLoaded || !sceneReady) return;
    scrollVelocityX += event.deltaY * scrollSensitivity;
}, { passive: true });

// Mouse Move Listener
let currentMouseX = 0; let currentMouseY = 0;
function onMouseMove(event) {
    currentMouseX = event.clientX; currentMouseY = event.clientY;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
}
window.addEventListener('mousemove', onMouseMove);

// --- Touch Event Listeners for Scrolling ---
function onTouchStart(event) {
    if (!isCameraLoaded || !sceneReady) return;
    if (event.touches.length === 1) {
        isTouching = true;
        touchStartY = event.touches[0].clientY;
    }
}

function onTouchMove(event) {
    if (!isCameraLoaded || !sceneReady || !isTouching || event.touches.length !== 1) {
        isTouching = event.touches.length === 1;
        return;
    }
    event.preventDefault(); // Prevent page scroll
    const currentTouchY = event.touches[0].clientY;
    const deltaY = currentTouchY - touchStartY;

    // Add velocity based on swipe direction (match wheel scroll direction)
    // Swipe down (positive deltaY) -> move left (negative velocity) ? Let's test.
    // Wheel down (positive deltaY) -> move right (positive velocity)
    // --> Need to invert touch delta sign or sensitivity sign
    scrollVelocityX -= deltaY * touchScrollSensitivity; // Inverted sign for deltaY

    // Update touchStartY for delta calculation relative to the *last* position
    // This generally feels more natural for dragging/swiping
    touchStartY = currentTouchY;
}

function onTouchEnd(event) {
    if (isTouching && event.touches.length === 0) { // Only reset if the primary touch ended
         isTouching = false;
    }
     // Don't reset isTouching if multi-touch ends but one touch remains
}

// Add touch listeners to the canvas
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd);
canvas.addEventListener('touchcancel', onTouchEnd);


// Audio Unlock Button Listener
audioUnlockButton.addEventListener('click', () => {
    if (!listener) {
        console.error("Audio Listener not initialized yet.");
        audioUnlockButton.textContent = "Error: Audio not ready";
        return;
    }
    // Resume AudioContext
    if (listener.context.state === 'suspended') {
        listener.context.resume().then(() => {
            console.log("AudioContext resumed successfully.");
            audioContextResumed = true;
            playBackgroundSound();
            startExperience();
        }).catch(e => {
             console.error("Error resuming AudioContext:", e);
             audioUnlockButton.textContent = "Audio Error";
             startExperience(); // Still start even if audio fails
        });
    } else if (listener.context.state === 'running') {
         console.log("AudioContext already running.");
         audioContextResumed = true;
         playBackgroundSound();
         startExperience();
    } else {
        console.warn("AudioContext in unexpected state:", listener.context.state);
        startExperience();
    }
    audioUnlockButton.classList.add('hidden');
});

// Function to hide overlay and start animation loop
function startExperience() {
    if (!sceneReady) {
         loadingOverlay.classList.add('hidden');
         sceneReady = true;
         if (isCameraLoaded) {
             clock.start();
             animate(); // Start the animation loop
         } else {
             console.error("Camera not loaded, cannot start animation loop.");
             loadingOverlay.classList.remove('hidden');
             loadingProgressElement.textContent = "Error: Camera Failed";
             loadingProgressElement.style.display = 'block';
             audioUnlockButton.style.display = 'none';
         }
    }
}

// Function to play background sound
function playBackgroundSound() {
    if (backgroundSound && audioContextResumed && !backgroundSound.isPlaying) {
        try {
            backgroundSound.play();
            console.log(`Background sound "${backgroundSoundPath}" playing.`);
        } catch (e) {
            console.error("Error trying to play background sound:", e);
        }
    } // Add logging for other cases if needed
}

// --- GLTF Loader ---
loader.load(
    modelPath,
    // ** onLoad Callback **
    function (gltf) {
        console.log('GLTF loaded successfully:', gltf);
        const loadedScene = gltf.scene;
        scene.add(loadedScene);

        // --- Find and Use Camera ---
        if (gltf.cameras && gltf.cameras.length > 0) {
            importedCamera = gltf.cameras.find(cam => cam.name === 'MyExportCamera') || gltf.cameras[0];
            if (importedCamera) {
                console.log('Using camera from GLTF:', importedCamera.name);
                importedCamera.aspect = window.innerWidth / window.innerHeight;
                importedCamera.updateProjectionMatrix();
                isCameraLoaded = true;
                // Clamp initial camera position
                importedCamera.position.x = Math.max(minCameraX, Math.min(maxCameraX, importedCamera.position.x));
                importedCamera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, importedCamera.position.z));

                // --- Initialize Audio Listener (attach to camera) ---
                listener = new THREE.AudioListener();
                importedCamera.add(listener);

            } else { console.warn("Could not find 'MyExportCamera' or any camera in the GLTF file."); }
        } else { console.warn("No cameras found in the GLTF file."); }

        // Fallback Camera Creation
        if (!isCameraLoaded) {
            console.log("Creating default PerspectiveCamera as fallback.");
            importedCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
            importedCamera.position.z = 5;
            scene.add(importedCamera);
            isCameraLoaded = true;
            listener = new THREE.AudioListener();
            importedCamera.add(listener);
        }


        // --- Apply Video Textures ---
        let videoMeshesFoundCount = 0;
        loadedScene.traverse((child) => {
            // Check if it's a mesh and its name is in our target list
            if (child.isMesh && videoPlanes.includes(child.name)) {
                videoMeshesFoundCount++;
                const meshName = child.name;
                const videoInfo = videoFileMap[meshName];

                if (!videoInfo) {
                    console.warn(`No video info defined in videoFileMap for mesh: ${meshName}. Skipping.`);
                    return; // Skip to next child
                }

                // ** UPDATED/GENERALIZED Logic **
                let videoPath;
                let useCanvasTexture = false;

                // Determine path and method based on Safari and availability of specific path
                if (isSafari && videoInfo.safari) {
                    videoPath = videoInfo.safari;
                    useCanvasTexture = true;
                    console.log(`Safari detected: Using HEVC path for ${meshName}: ${videoPath}`);
                } else if (videoInfo.default) {
                    // Use default path if not Safari OR if no specific Safari path is defined
                    videoPath = videoInfo.default;
                    useCanvasTexture = false; // Use standard VideoTexture
                     console.log(`${isSafari ? 'Safari (no specific path)' : 'Non-Safari'}: Using default path for ${meshName}: ${videoPath}`);
                } else {
                    // If neither safari nor default path exists
                    console.warn(`No suitable video path (Safari or default) found for mesh: ${meshName}. Skipping.`);
                    return; // Skip to next child
                }

                // --- Create and Apply Texture (Logic remains the same based on useCanvasTexture) ---
                if (useCanvasTexture) {
                    // --- Canvas Texture Path (Safari HEVC) ---
                    const textureObj = createCanvasVideoTexture(videoPath, (texture, videoEl) => {
                        // console.log(`Canvas texture created and ready for ${meshName}`); // Less verbose
                        videoElements[meshName] = videoEl;
                        videoMeshes.push(child);
                        canvasTextureObjects[meshName] = textureObj;

                        const material = new THREE.MeshBasicMaterial({
                            map: texture,
                            side: THREE.DoubleSide,
                            transparent: true,
                            alphaTest: 0.01,
                        });
                        child.material = material;
                        // console.log(`Canvas-based texture material applied to ${meshName}`); // Less verbose
                        videoEl.pause();
                    });
                } else {
                    // --- Standard VideoTexture Path (WebM, other browsers) ---
                    const video = document.createElement('video');
                    video.src = videoPath;
                    video.loop = true;
                    video.muted = true;
                    video.playsInline = true;
                    video.crossOrigin = 'anonymous';
                    video.pause();

                    videoElements[meshName] = video;
                    videoMeshes.push(child);

                    const videoTexture = new THREE.VideoTexture(video);
                    videoTexture.format = THREE.RGBAFormat; // Use RGBA for WebM alpha too
                    videoTexture.minFilter = THREE.LinearFilter;
                    videoTexture.magFilter = THREE.LinearFilter;
                    videoTexture.generateMipmaps = false;
                    videoTexture.flipY = false; // Match GLTF standard

                    if (child.material) {
                         if (Array.isArray(child.material)) {
                             if (child.material.length > 0) {
                                 child.material[0].map = videoTexture;
                                 child.material[0].transparent = true;
                                 child.material[0].alphaTest = 0.01;
                                 child.material[0].needsUpdate = true;
                             } else {
                                 child.material.push(new THREE.MeshBasicMaterial({ map: videoTexture, transparent: true, alphaTest: 0.01, side: THREE.DoubleSide }));
                             }
                         } else {
                             child.material.map = videoTexture;
                             child.material.transparent = true;
                             child.material.alphaTest = 0.01;
                             child.material.needsUpdate = true;
                         }
                         // console.log(`Standard VideoTexture applied to material of "${meshName}"`); // Less verbose
                    } else {
                        console.warn(`Mesh "${meshName}" had no material. Creating MeshBasicMaterial.`);
                        child.material = new THREE.MeshBasicMaterial({
                            map: videoTexture,
                            side: THREE.DoubleSide,
                            transparent: true,
                            alphaTest: 0.01
                        });
                    }

                    video.addEventListener('canplay', () => {
                       // console.log(`Video "${videoPath}" is ready (remains paused).`); // Less verbose
                    });
                    video.addEventListener('error', (e) => {
                       console.error(`Error loading video: ${videoPath}`, e);
                    });
                }
            }
        }); // End traverse

        if (videoMeshesFoundCount !== videoPlanes.length) {
            console.warn(`Expected ${videoPlanes.length} video meshes based on 'videoPlanes' array, but found ${videoMeshesFoundCount} matching meshes in the GLTF.`);
        }

        // --- Load Background Sound ---
        if (listener) {
            backgroundSound = new THREE.Audio(listener);
            const audioLoader = new THREE.AudioLoader(loadingManager);
            audioLoader.load(backgroundSoundPath, function(buffer) {
                backgroundSound.setBuffer(buffer);
                backgroundSound.setLoop(true);
                backgroundSound.setVolume(0.5);
                console.log(`Background sound "${backgroundSoundPath}" loaded.`);
            },
            undefined,
            function (err) { console.error('Error loading background sound:', err); }
            );
        } else { console.error("Audio Listener could not be initialized. Background sound not loaded."); }

    },
    undefined, // onProgress handled by manager
    // ** onError Callback for GLTF Loader **
    function (error) {
        console.error('An error happened loading the GLTF model:', error);
        loadingProgressElement.textContent = 'Error loading 3D model!';
        loadingProgressElement.style.display = 'block';
        audioUnlockButton.style.display = 'none';
        loadingOverlay.classList.remove('hidden');
    }
);

// --- Handle Window Resizing ---
function onWindowResize() {
    if (isCameraLoaded) {
        importedCamera.aspect = window.innerWidth / window.innerHeight;
        importedCamera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onWindowResize);

// --- Animation Loop ---
function animate() {
    if (!sceneReady || !isCameraLoaded) return;

    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- Star Twinkling ---
    if (starMaterial) {
        const mouseDist = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
        const twinkleSpeed = 1 + mouseDist * 2;
        starMaterial.size = 0.15 + Math.sin(elapsedTime * twinkleSpeed) * 0.05;
        starMaterial.opacity = 0.85 + Math.sin(elapsedTime * twinkleSpeed * 0.7) * 0.1;
    }

    // --- Raycasting for Video/Info Panel ---
    let intersectedVideoElement = null;
    let intersectedMeshName = null;

    if (videoMeshes.length > 0 && importedCamera) {
        // Only update raycaster if mouse is potentially over the canvas (-1 to 1 range)
        // Or if touching (for potential touch interaction later)
        // This is a micro-optimization, might not be necessary
        // if ( (mouse.x >= -1 && mouse.x <= 1 && mouse.y >= -1 && mouse.y <= 1) || isTouching ) {
             raycaster.setFromCamera(mouse, importedCamera);
             const intersects = raycaster.intersectObjects(videoMeshes, false);

             if (intersects.length > 0) {
                 const intersectedMesh = intersects[0].object;
                 if (intersectedMesh && videoElements[intersectedMesh.name]) {
                     intersectedVideoElement = videoElements[intersectedMesh.name];
                     intersectedMeshName = intersectedMesh.name;
                 }
             }
        // }
    }

    // --- Control Video Playback ---
    if (intersectedVideoElement) {
        if (currentlyHoveredVideo !== intersectedVideoElement) {
            if (currentlyHoveredVideo) { currentlyHoveredVideo.pause(); }

            if (audioContextResumed || intersectedVideoElement.muted) {
                 const playPromise = intersectedVideoElement.play();
                 if (playPromise !== undefined) {
                     playPromise.catch(error => {
                         if (error.name !== 'AbortError') {
                              console.error(`Error playing video "${intersectedVideoElement.src}":`, error);
                         }
                     });
                 }
            } else {
                // console.warn(`Video hover for "${intersectedVideoElement.src}" but audio context not ready. Kept paused.`); // Less verbose
            }
            currentlyHoveredVideo = intersectedVideoElement;
        }
    } else {
        if (currentlyHoveredVideo) {
            currentlyHoveredVideo.pause();
            currentlyHoveredVideo = null;
        }
    }

    // --- Control Info Panel ---
    if (intersectedMeshName && infoPanelElement) {
        infoPanelElement.innerHTML = infoPanelData[intersectedMeshName] || 'Info not available.';
        // Position panel
        const panelWidth = infoPanelElement.offsetWidth;
        const panelHeight = infoPanelElement.offsetHeight;
        let panelX = currentMouseX + infoPanelOffset.x;
        let panelY = currentMouseY + infoPanelOffset.y;
        if (panelX + panelWidth > window.innerWidth) { panelX = currentMouseX - panelWidth - infoPanelOffset.x; }
        if (panelY + panelHeight > window.innerHeight) { panelY = currentMouseY - panelHeight - infoPanelOffset.y; }
        panelX = Math.max(0, panelX); // Prevent going off left
        panelY = Math.max(0, panelY); // Prevent going off top
        infoPanelElement.style.left = `${panelX}px`;
        infoPanelElement.style.top = `${panelY}px`;
        infoPanelElement.style.display = 'block';
    } else if (infoPanelElement) {
        infoPanelElement.style.display = 'none';
    }


    // --- Camera Movement Logic ---
    if (isCameraLoaded) {
        // Calculate Camera Local Axes
        const forward = new THREE.Vector3();
        importedCamera.getWorldDirection(forward);
        const right = new THREE.Vector3();
        right.crossVectors(importedCamera.up, forward).normalize().negate();

        // --- WASD Movement ---
        const wasdMoveDistance = moveSpeed * delta;
        const potentialPositionWASD = importedCamera.position.clone();
        let movedWASD = false;
        if (keyStates.W) { potentialPositionWASD.addScaledVector(forward, wasdMoveDistance); movedWASD = true; }
        if (keyStates.S) { potentialPositionWASD.addScaledVector(forward, -wasdMoveDistance); movedWASD = true; }
        if (keyStates.A) { potentialPositionWASD.addScaledVector(right, -wasdMoveDistance); movedWASD = true; }
        if (keyStates.D) { potentialPositionWASD.addScaledVector(right, wasdMoveDistance); movedWASD = true; }

        // Apply WASD movement with clamping
        if (movedWASD) {
             potentialPositionWASD.x = Math.max(minCameraX, Math.min(maxCameraX, potentialPositionWASD.x));
             potentialPositionWASD.z = Math.max(minCameraZ, Math.min(maxCameraZ, potentialPositionWASD.z));
             importedCamera.position.copy(potentialPositionWASD);
        }

        // --- Scroll/Touch Movement (Velocity Based) ---
        if (Math.abs(scrollVelocityX) > 0.0001) { // Lower threshold for stopping
            const scrollMoveStep = scrollVelocityX * delta;
            const moveVector = right.clone().multiplyScalar(scrollMoveStep);
            const potentialPositionScroll = importedCamera.position.clone().add(moveVector);

            // Check bounds *before* applying
            if (potentialPositionScroll.x > minCameraX && potentialPositionScroll.x < maxCameraX &&
                potentialPositionScroll.z > minCameraZ && potentialPositionScroll.z < maxCameraZ) { // Use strict inequality to prevent getting stuck?
                importedCamera.position.add(moveVector);
                 // Apply Damping only if movement occurred and we are not touching
                 if (!isTouching) {
                    scrollVelocityX *= scrollDamping;
                 }
            } else {
                // If move goes out of bounds, clamp position and kill velocity
                importedCamera.position.x = Math.max(minCameraX, Math.min(maxCameraX, potentialPositionScroll.x));
                importedCamera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, potentialPositionScroll.z));
                scrollVelocityX = 0; // Stop velocity when hitting boundary
            }
        } else {
             scrollVelocityX = 0; // Snap to zero if below threshold
        }
         // If touching, don't apply damping (let touchmove control velocity directly)
         // Damping is applied automatically when touch ends and velocity is > threshold


    } // End if(isCameraLoaded)


    // --- Rendering ---
    if (isCameraLoaded) {
        renderer.render(scene, importedCamera);
    }
}

// --- Initial Setup ---
// Event listeners are added above.
// Animation loop starts via startExperience() after loading & user interaction.

// --- Cleanup ---
window.addEventListener('beforeunload', () => {
    console.log("Cleaning up Three.js resources...");
    sceneReady = false; // Stop animate loop

    // Dispose Three.js objects
    scene.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
            if (Array.isArray(object.material)) {
                object.material.forEach(material => {
                     if (material.map) material.map.dispose();
                     material.dispose();
                });
            } else {
                 if (object.material.map) object.material.map.dispose();
                 object.material.dispose();
            }
        }
    });

     // Dispose canvas textures
     Object.values(canvasTextureObjects).forEach(obj => obj.dispose());

    // Dispose renderer
    renderer.dispose();

    // Stop audio
    if (backgroundSound && backgroundSound.isPlaying) {
        backgroundSound.stop();
    }
     // Stop videos and release resources
     Object.values(videoElements).forEach(video => {
         video.pause();
         video.removeAttribute('src');
         video.load();
     });

    console.log("Cleanup complete.");
});
