import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Basic Setup ---
const canvas = document.querySelector('#c');
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    canvas: canvas
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
// renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
// scene.background = new THREE.Color(0); // Using starfield instead

// --- DOM Elements ---
const loadingOverlay = document.getElementById('loading-overlay');
const loadingProgressElement = document.getElementById('loading-progress');
const audioUnlockButton = document.getElementById('audio-unlock-button');
const infoPanelElement = document.getElementById('info-panel');

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
    // Delay hiding overlay slightly for visual feedback
    setTimeout(() => {
        // Keep overlay but hide progress text and show button
        loadingProgressElement.style.display = 'none'; // Hide progress text
        audioUnlockButton.style.display = 'block'; // Show audio button
        // Do NOT hide the overlay here, wait for button click
    }, 500); // 0.5 second delay

};

loadingManager.onProgress = function ( url, itemsLoaded, itemsTotal ) {
	console.log( `Loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.` );
    const progress = Math.round((itemsLoaded / itemsTotal * 100));
    loadingProgressElement.textContent = `Loading... ${progress}%`;
};

loadingManager.onError = function ( url ) {
	console.error( 'There was an error loading ' + url );
    loadingProgressElement.textContent = `Error loading: ${url}`;
    audioUnlockButton.style.display = 'none'; // Hide button on error
    // Keep overlay visible on error
};


// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(5, 10, 7.5).normalize();
scene.add(directionalLight);

// --- Starry Background ---
let starMaterial; // Declare material in higher scope for animation access
const starCount = 50000; // Increased star count
const starVertices = [];
const starGeometry = new THREE.BufferGeometry();

for (let i = 0; i < starCount; i++) {
    const theta = THREE.MathUtils.randFloatSpread(360); const phi = THREE.MathUtils.randFloatSpread(360);
    const radius = THREE.MathUtils.randFloat(50, 150);
    const x = radius * Math.sin(theta) * Math.cos(phi); const y = radius * Math.sin(theta) * Math.sin(phi); const z = radius * Math.cos(theta);
    starVertices.push(x, y, z);
}
starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true, transparent: true, opacity: 0.85 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);


// --- GLTF Loading ---
const loader = new GLTFLoader(loadingManager); // Pass LoadingManager
let importedCamera;

const modelPath = 'assets/MockupWebsite_webm_noBackground.glb';
const backgroundSoundPath = 'assets/MixStereo.wav';

// --- Video Plane Setup ---
const videoPlanes = [ 'lanternBugfly_webm', 'lunaMoth_webm', 'tigerButterfly_webm' ];
const videoElements = {};
const videoMeshes = [];
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
const mouse = new THREE.Vector2(-2, -2);

// --- Movement Setup ---
const clock = new THREE.Clock();
const moveSpeed = 3.0;
const scrollSensitivity = 0.02;
const scrollDamping = 0.60;

// ** Clamping Bounds **
const minCameraX = -50; const maxCameraX = 50;
const minCameraZ = -1.45; const maxCameraZ = 1.45;

const keyStates = { W: false, A: false, S: false, D: false };
let scrollVelocityX = 0;
let isCameraLoaded = false;
let sceneReady = false; // Flag to indicate scene and assets are ready

// --- Audio Setup ---
let listener;
let backgroundSound;
let audioContextResumed = false; // Flag to track if context is unlocked

// --- Event Listeners ---
// (WASD, Scroll, MouseMove listeners remain the same)
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
window.addEventListener('wheel', (event) => {
    if (!isCameraLoaded || !sceneReady) return; // Only scroll if scene is ready
    scrollVelocityX += event.deltaY * scrollSensitivity;
}, { passive: true });

let currentMouseX = 0; let currentMouseY = 0;
function onMouseMove(event) {
    currentMouseX = event.clientX; currentMouseY = event.clientY;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
}
window.addEventListener('mousemove', onMouseMove);

// Audio Unlock Button Listener
audioUnlockButton.addEventListener('click', () => {
    if (!listener) {
        console.error("Audio Listener not initialized yet.");
        audioUnlockButton.textContent = "Error: Audio not ready";
        return;
    }
    // Resume AudioContext on user interaction
    if (listener.context.state === 'suspended') {
        listener.context.resume().then(() => {
            console.log("AudioContext resumed successfully.");
            audioContextResumed = true;
            playBackgroundSound(); // Attempt to play sound now
            startExperience(); // Hide overlay and start animation
        }).catch(e => {
             console.error("Error resuming AudioContext:", e);
             audioUnlockButton.textContent = "Audio Error";
        });
    } else if (listener.context.state === 'running') {
         console.log("AudioContext already running.");
         audioContextResumed = true;
         playBackgroundSound(); // Attempt to play sound now
         startExperience(); // Hide overlay and start animation
    } else {
        console.warn("AudioContext in unexpected state:", listener.context.state);
        startExperience(); // Still start experience even if audio state is weird
    }
    // Hide button immediately after click attempt
    audioUnlockButton.classList.add('hidden');
});

// Function to hide overlay and start animation loop
function startExperience() {
    if (!sceneReady) { // Ensure this is only called once
         loadingOverlay.classList.add('hidden'); // Hide the overlay
         sceneReady = true;
         if (isCameraLoaded) {
             clock.start(); // Start the clock when animation begins
             animate(); // Start the animation loop
         } else {
             console.error("Camera not loaded, cannot start animation loop.");
             alert("Error: Could not initialize camera.");
         }
    }
}


// Function to play background sound (checks if context is ready)
function playBackgroundSound() {
    if (backgroundSound && audioContextResumed && !backgroundSound.isPlaying) {
        try {
            backgroundSound.play();
            console.log(`Background sound "${backgroundSoundPath}" playing after user interaction.`);
        } catch (e) {
            console.error("Error trying to play background sound:", e);
        }
    } else if (backgroundSound && backgroundSound.isPlaying) {
        console.log("Background sound already playing.");
    } else if (!backgroundSound) {
         console.warn("Background sound object not loaded or initialized yet.");
    } else if (!audioContextResumed) {
         console.warn("Audio context not resumed yet, cannot play sound.");
    }
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
                importedCamera.position.x = Math.max(minCameraX, Math.min(maxCameraX, importedCamera.position.x));
                importedCamera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, importedCamera.position.z));

                // --- Initialize Audio Listener ---
                listener = new THREE.AudioListener();
                importedCamera.add(listener); // Attach listener AFTER camera is found

            } else { console.warn("Could not find a suitable camera in the GLTF file."); }
        } else { console.warn("No cameras found in the GLTF file."); }

        // --- Apply Video Textures ---
        let videoMeshesFoundCount = 0;
        loadedScene.traverse((child) => {
            if (child.isMesh && videoPlanes.includes(child.name)) {
                videoMeshesFoundCount++;
                const meshName = child.name;
                const videoPath = `assets/${meshName}.webm`;
                // console.log(`Found mesh named "${meshName}". Applying video texture from "${videoPath}".`);
                const video = document.createElement('video');
                video.src = videoPath; video.loop = true; video.muted = true;
                video.playsInline = true; video.crossOrigin = 'anonymous'; video.pause();
                videoElements[meshName] = video;
                videoMeshes.push(child);
                const videoTexture = new THREE.VideoTexture(video);
                videoTexture.colorSpace = THREE.SRGBColorSpace;
                videoTexture.needsUpdate = true;
                videoTexture.flipY = false;
                if (child.material) {
                     if (Array.isArray(child.material)) {
                        if (child.material.length > 0) { child.material[0].map = videoTexture; child.material[0].needsUpdate = true; }
                     } else {
                        child.material.map = videoTexture;
                        if (child.material.isMeshStandardMaterial) {
                             child.material.emissiveMap = videoTexture; child.material.emissiveIntensity = 1.0;
                        }
                        child.material.needsUpdate = true;
                     }
                     // console.log(`Video texture applied to material of "${meshName}"`);
                } else { console.warn(`Mesh "${meshName}" found, but it has no material.`); }
            }
        });
        if (videoMeshesFoundCount !== videoPlanes.length) { console.warn(`Expected ${videoPlanes.length} video meshes, but found ${videoMeshesFoundCount}.`); }

        // --- Load Background Sound ---
        // Moved audio initialization to *after* camera/listener setup
        if (listener) {
            backgroundSound = new THREE.Audio(listener);
            const audioLoader = new THREE.AudioLoader(loadingManager); // Pass LoadingManager

            audioLoader.load(backgroundSoundPath, function(buffer) {
                backgroundSound.setBuffer(buffer);
                backgroundSound.setLoop(true);
                backgroundSound.setVolume(0.5);
                console.log(`Background sound "${backgroundSoundPath}" loaded.`);
                // ** DO NOT PLAY HERE ** - Wait for button click
            },
            undefined, // onProgress handled by manager
            function (err) { console.error('An error happened loading the background sound:', err); }
            );
        } else { console.error("Audio Listener could not be initialized."); }


        // ** DO NOT START ANIMATION HERE **
        // Animation loop is started by the audio unlock button click or if audio fails init
        // if (isCameraLoaded) { animate(); } ...
    },
    undefined, // onProgress handled by manager
    // ** onError Callback for GLTF Loader **
    function (error) {
        console.error('An error happened loading the GLTF model:', error);
        alert(`Error loading GLTF model. Check console and path: ${modelPath}`);
        loadingProgressElement.textContent = 'Error loading model!';
        audioUnlockButton.style.display = 'none'; // Hide button on model load error
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
// Defined here, but called only after loading/user interaction
function animate() {
    // Stop the loop if the scene isn't marked as ready (e.g., if called prematurely somehow)
    if (!sceneReady) return;

    requestAnimationFrame(animate); // Request next frame first

    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- Star Twinkling Animation ---
    if (starMaterial) {
        const mouseDist = Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y);
        const twinkleSpeed = 1 + mouseDist * 3;
        starMaterial.size = 0.15 + Math.sin(elapsedTime * twinkleSpeed) * 0.05;
    }

    // --- Raycasting for Video Playback & Info Panel ---
    let intersectedVideoElement = null;
    let intersectedMeshName = null;

    if (videoMeshes.length > 0) {
        raycaster.setFromCamera(mouse, importedCamera);
        const intersects = raycaster.intersectObjects(videoMeshes, false);
        if (intersects.length > 0) {
            const intersectedMesh = intersects[0].object;
            if (intersectedMesh && videoElements[intersectedMesh.name]) {
                intersectedVideoElement = videoElements[intersectedMesh.name];
                intersectedMeshName = intersectedMesh.name;
            }
        }
    }

    // --- Control Video Playback based on Raycast ---
    if (intersectedVideoElement) {
        if (currentlyHoveredVideo !== intersectedVideoElement) {
            if (currentlyHoveredVideo) { currentlyHoveredVideo.pause(); }
            // Only play video if audio context is resumed (important for non-muted videos, good practice)
            if (audioContextResumed || intersectedVideoElement.muted) {
                 intersectedVideoElement.play().catch(e => console.error("Error playing video:", e));
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
        infoPanelElement.innerHTML = infoPanelData[intersectedMeshName] || 'No info available.';
        const panelWidth = infoPanelElement.offsetWidth; const panelHeight = infoPanelElement.offsetHeight;
        let panelX = currentMouseX + infoPanelOffset.x; let panelY = currentMouseY + infoPanelOffset.y;
        if (panelX + panelWidth > window.innerWidth) { panelX = currentMouseX - panelWidth - infoPanelOffset.x; }
        if (panelY + panelHeight > window.innerHeight) { panelY = currentMouseY - panelHeight - infoPanelOffset.y; }
        if (panelX < 0) panelX = 0; if (panelY < 0) panelY = 0;
        infoPanelElement.style.left = `${panelX}px`; infoPanelElement.style.top = `${panelY}px`;
        infoPanelElement.style.display = 'block';
    } else if (infoPanelElement) {
        infoPanelElement.style.display = 'none';
    }


    // --- Calculate Camera Local Axes ---
    const forward = new THREE.Vector3();
    importedCamera.getWorldDirection(forward);
    const right = new THREE.Vector3();
    right.crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize().negate();

    // --- Camera Movement Logic ---
    const wasdMoveDistance = moveSpeed * delta;
    const potentialPositionWASD = importedCamera.position.clone();
    let movedWASD = false;
    if (keyStates.W) { potentialPositionWASD.addScaledVector(forward, wasdMoveDistance); movedWASD = true; }
    if (keyStates.S) { potentialPositionWASD.addScaledVector(forward, -wasdMoveDistance); movedWASD = true; }
    if (keyStates.A) { potentialPositionWASD.addScaledVector(right, -wasdMoveDistance); movedWASD = true; }
    if (keyStates.D) { potentialPositionWASD.addScaledVector(right, wasdMoveDistance); movedWASD = true; }

    if (movedWASD) {
        if (potentialPositionWASD.x >= minCameraX && potentialPositionWASD.x <= maxCameraX &&
            potentialPositionWASD.z >= minCameraZ && potentialPositionWASD.z <= maxCameraZ) {
            importedCamera.position.copy(potentialPositionWASD);
        } else {
            importedCamera.position.x = Math.max(minCameraX, Math.min(maxCameraX, importedCamera.position.x));
            importedCamera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, importedCamera.position.z));
        }
    }

    let appliedScrollMovement = false;
    if (Math.abs(scrollVelocityX) > 0.001) {
        const scrollMoveDistance = scrollVelocityX * delta;
        const moveVector = right.clone().multiplyScalar(scrollMoveDistance);
        const potentialPositionScroll = importedCamera.position.clone().add(moveVector);

        if (potentialPositionScroll.x >= minCameraX && potentialPositionScroll.x <= maxCameraX &&
            potentialPositionScroll.z >= minCameraZ && potentialPositionScroll.z <= maxCameraZ) {
            importedCamera.position.add(moveVector);
            appliedScrollMovement = true;
        } else {
            importedCamera.position.x = Math.max(minCameraX, Math.min(maxCameraX, importedCamera.position.x));
            importedCamera.position.z = Math.max(minCameraZ, Math.min(maxCameraZ, importedCamera.position.z));
            scrollVelocityX = 0;
        }

        if (appliedScrollMovement || Math.abs(scrollVelocityX) > 0.001) {
             scrollVelocityX *= scrollDamping;
        } else { scrollVelocityX = 0; }
    } else { scrollVelocityX = 0; }

    // --- Logging ---
    // console.log(`Cam Pos: X=${importedCamera.position.x.toFixed(2)}, Y=${importedCamera.position.y.toFixed(2)}, Z=${importedCamera.position.z.toFixed(2)} | ScrollVel: ${scrollVelocityX.toFixed(3)}`);

    // --- Rendering ---
    renderer.render(scene, importedCamera);
}
