(function () {
  if (window.__pqRegionCaptureListener) {
    chrome.runtime.onMessage.removeListener(window.__pqRegionCaptureListener);
  }

  let overlay = null;
  let selectionBox = null;
  let startX = 0;
  let startY = 0;
  let activeResolve = null;
  let activeReject = null;

  const listener = (message, sender, sendResponse) => {
    if (message?.type !== 'START_REGION_CAPTURE') {
      return;
    }

    startRegionSelection()
      .then((region) => sendResponse({ ok: true, region }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  };

  chrome.runtime.onMessage.addListener(listener);
  window.__pqRegionCaptureListener = listener;

  function startRegionSelection() {
    if (overlay) {
      return Promise.reject(new Error('Capture already in progress'));
    }

    return new Promise((resolve, reject) => {
      activeResolve = resolve;
      activeReject = reject;
      createOverlay();
    });
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.zIndex = '2147483647';
    overlay.style.cursor = 'crosshair';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.25)';
    overlay.style.backdropFilter = 'blur(1px)';
    overlay.style.userSelect = 'none';

    selectionBox = document.createElement('div');
    selectionBox.style.position = 'absolute';
    selectionBox.style.border = '2px solid #4da3ff';
    selectionBox.style.backgroundColor = 'rgba(77,163,255,0.2)';
    selectionBox.style.pointerEvents = 'none';
    overlay.appendChild(selectionBox);

    const instruction = document.createElement('div');
    instruction.textContent = 'Drag to capture • Cancel';
    instruction.style.position = 'absolute';
    instruction.style.top = '12px';
    instruction.style.right = '12px';
    instruction.style.padding = '6px 10px';
    instruction.style.fontFamily = 'system-ui, sans-serif';
    instruction.style.fontSize = '12px';
    instruction.style.color = '#ffffff';
    instruction.style.backgroundColor = 'rgba(0,0,0,0.5)';
    instruction.style.borderRadius = '999px';
    instruction.style.cursor = 'pointer';
    instruction.addEventListener('click', cancelSelection);
    overlay.appendChild(instruction);

    overlay.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp, { once: true });
    document.addEventListener('keydown', handleKeyDown, { once: false });

    document.body.appendChild(overlay);
  }

  function handleMouseDown(event) {
    if (event.button !== 0) {
      return;
    }
    startX = event.clientX;
    startY = event.clientY;
    updateSelection(event);
    overlay.addEventListener('mousemove', handleMouseMove);
  }

  function handleMouseMove(event) {
    updateSelection(event);
  }

  function handleMouseUp(event) {
    overlay?.removeEventListener('mousemove', handleMouseMove);

    if (!selectionBox) {
      const rejectFn = activeReject;
      cleanup();
      rejectFn?.(new Error('Selection unavailable'));
      return;
    }

    const width = Math.abs(event.clientX - startX);
    const height = Math.abs(event.clientY - startY);

    if (width < 5 || height < 5) {
      const rejectFn = activeReject;
      cleanup();
      rejectFn?.(new Error('Selection too small'));
      return;
    }

    const region = {
      x: Math.min(startX, event.clientX),
      y: Math.min(startY, event.clientY),
      width,
      height,
      devicePixelRatio: window.devicePixelRatio
    };

    const resolveFn = activeResolve;
    cleanup();
    resolveFn?.(region);
  }

  function updateSelection(event) {
    const currentX = event.clientX;
    const currentY = event.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    Object.assign(selectionBox.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    });
  }

  function cancelSelection() {
    const rejectFn = activeReject;
    cleanup();
    rejectFn?.(new Error('Selection cancelled'));
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      cancelSelection();
    }
  }

  function cleanup() {
    overlay?.removeEventListener('mousedown', handleMouseDown);
    document.removeEventListener('keydown', handleKeyDown);
    overlay?.remove();
    overlay = null;
    selectionBox = null;
    activeResolve = null;
    activeReject = null;
  }
})();
