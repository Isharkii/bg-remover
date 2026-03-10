
import { useEffect, useRef, useState } from "react";
import { fabric } from "fabric";

const MAX_CANVAS_EDGE = 1400;
const HISTORY_LIMIT = 80;
const MIN_PEN_POINTS = 3;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createFabricImage(url) {
  return new Promise((resolve, reject) => {
    fabric.Image.fromURL(
      url,
      (img) => {
        if (!img) {
          reject(new Error("Failed to load image."));
          return;
        }
        resolve(img);
      },
      { crossOrigin: "anonymous" }
    );
  });
}

function createHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to read image data."));
    img.src = url;
  });
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = parts[0].match(/:(.*?);/)?.[1] || "image/png";
  const binary = atob(parts[1] || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export default function App() {
  const canvasNodeRef = useRef(null);
  const fabricCanvasRef = useRef(null);
  const replaceInputRef = useRef(null);
  const layerInputRef = useRef(null);

  const toolModeRef = useRef("select");
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const restoringHistoryRef = useRef(false);
  const pauseHistoryRef = useRef(false);
  const historyDebounceTimerRef = useRef(null);

  const rectStartRef = useRef(null);
  const rectDraftRef = useRef(null);
  const penPointsRef = useRef([]);
  const penGuideRef = useRef(null);

  const [toolMode, setToolMode] = useState("select");
  const [status, setStatus] = useState("Upload a photo to start editing.");
  const [dropActive, setDropActive] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionType, setSelectionType] = useState("none");
  const [brushSize, setBrushSize] = useState(24);
  const [brushColor, setBrushColor] = useState("#14d9c9");
  const [shapeColor, setShapeColor] = useState("#f5aa42");
  const [textColor, setTextColor] = useState("#fff7ec");
  const [textValue, setTextValue] = useState("Type here");
  const [textSize, setTextSize] = useState(42);
  const [downloadFormat, setDownloadFormat] = useState("png");
  const [removeBgEndpoint, setRemoveBgEndpoint] = useState(
    "http://localhost:8000/remove-background"
  );
  const [filterValues, setFilterValues] = useState({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    blur: 0
  });

  toolModeRef.current = toolMode;

  function refreshUndoRedoState() {
    const index = historyIndexRef.current;
    const total = historyRef.current.length;
    setCanUndo(index > 0);
    setCanRedo(index >= 0 && index < total - 1);
  }

  function saveHistorySnapshot() {
    const canvas = fabricCanvasRef.current;
    if (!canvas || restoringHistoryRef.current || pauseHistoryRef.current) {
      return;
    }

    const snapshot = JSON.stringify(canvas.toDatalessJSON());
    const list = historyRef.current;
    const at = historyIndexRef.current;

    if (at >= 0 && list[at] === snapshot) {
      refreshUndoRedoState();
      return;
    }

    if (at < list.length - 1) {
      list.splice(at + 1);
    }

    list.push(snapshot);
    if (list.length > HISTORY_LIMIT) {
      list.shift();
    }
    historyIndexRef.current = list.length - 1;
    refreshUndoRedoState();
  }

  function queueHistorySnapshot() {
    if (historyDebounceTimerRef.current) {
      clearTimeout(historyDebounceTimerRef.current);
    }
    historyDebounceTimerRef.current = setTimeout(() => {
      saveHistorySnapshot();
    }, 120);
  }

  function syncSelectionState() {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject() ?? null;
    setHasSelection(Boolean(active));
    setSelectionType(active ? active.type : "none");
  }

  function clearRectDraft() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    if (rectDraftRef.current) {
      pauseHistoryRef.current = true;
      canvas.remove(rectDraftRef.current);
      pauseHistoryRef.current = false;
      rectDraftRef.current = null;
    }
    rectStartRef.current = null;
    canvas.requestRenderAll();
  }

  function clearPenGuide() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    if (penGuideRef.current) {
      pauseHistoryRef.current = true;
      canvas.remove(penGuideRef.current);
      pauseHistoryRef.current = false;
      penGuideRef.current = null;
      canvas.requestRenderAll();
    }
  }

  function drawPenGuide() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    const points = penPointsRef.current;
    clearPenGuide();

    if (points.length === 0) {
      return;
    }

    const guidePoints = points.length > 2 ? [...points, points[0]] : points;
    pauseHistoryRef.current = true;
    const polyline = new fabric.Polyline(guidePoints, {
      stroke: "#2de5ff",
      fill: points.length > 2 ? "rgba(45, 229, 255, 0.12)" : "",
      strokeWidth: 2,
      strokeDashArray: [8, 5],
      selectable: false,
      evented: false,
      objectCaching: false
    });
    polyline.excludeFromExport = true;
    canvas.add(polyline);
    polyline.bringToFront();
    pauseHistoryRef.current = false;
    penGuideRef.current = polyline;
    canvas.requestRenderAll();
  }

  function restoreHistoryIndex(nextIndex) {
    const canvas = fabricCanvasRef.current;
    const list = historyRef.current;
    const snapshot = list[nextIndex];

    if (!canvas || !snapshot) {
      return;
    }

    restoringHistoryRef.current = true;
    canvas.loadFromJSON(snapshot, () => {
      canvas.renderAll();
      restoringHistoryRef.current = false;
      historyIndexRef.current = nextIndex;
      refreshUndoRedoState();
      syncSelectionState();
      setStatus("History restored.");
    });
  }

  function undo() {
    if (!canUndo) {
      return;
    }
    clearRectDraft();
    penPointsRef.current = [];
    clearPenGuide();
    restoreHistoryIndex(historyIndexRef.current - 1);
  }

  function redo() {
    if (!canRedo) {
      return;
    }
    clearRectDraft();
    penPointsRef.current = [];
    clearPenGuide();
    restoreHistoryIndex(historyIndexRef.current + 1);
  }

  function switchTool(nextTool) {
    if (nextTool !== "rectCrop") {
      clearRectDraft();
    }
    if (nextTool !== "penCrop") {
      penPointsRef.current = [];
      clearPenGuide();
    }
    setToolMode(nextTool);
  }

  async function loadImageFile(file, replace = true) {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    if (!file || !file.type.startsWith("image/")) {
      setStatus("Please choose an image file.");
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    pauseHistoryRef.current = true;
    try {
      const img = await createFabricImage(objectUrl);
      const sourceWidth = img.width || 1;
      const sourceHeight = img.height || 1;

      if (replace) {
        clearRectDraft();
        penPointsRef.current = [];
        clearPenGuide();

        const baseScale = Math.min(
          1,
          MAX_CANVAS_EDGE / Math.max(sourceWidth, sourceHeight)
        );
        const targetWidth = Math.max(1, Math.round(sourceWidth * baseScale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * baseScale));

        canvas.clear();
        canvas.setWidth(targetWidth);
        canvas.setHeight(targetHeight);
        img.set({
          left: 0,
          top: 0,
          originX: "left",
          originY: "top"
        });
        img.scale(baseScale);
        canvas.add(img);
        canvas.setActiveObject(img);
      } else {
        const fitScale = Math.min(
          1,
          (canvas.getWidth() * 0.7) / sourceWidth,
          (canvas.getHeight() * 0.7) / sourceHeight
        );
        img.set({
          left: canvas.getWidth() / 2,
          top: canvas.getHeight() / 2,
          originX: "center",
          originY: "center"
        });
        img.scale(fitScale);
        canvas.add(img);
        canvas.setActiveObject(img);
      }

      canvas.requestRenderAll();
      switchTool("select");
      setStatus(
        replace ? `Loaded ${file.name}.` : `Added ${file.name} as a layer.`
      );
      syncSelectionState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to load image.");
    } finally {
      pauseHistoryRef.current = false;
      URL.revokeObjectURL(objectUrl);
      saveHistorySnapshot();
    }
  }

  function addShape(shape) {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    let obj = null;
    if (shape === "rect") {
      obj = new fabric.Rect({
        left: 80,
        top: 80,
        width: 220,
        height: 140,
        fill: "transparent",
        stroke: shapeColor,
        strokeWidth: 4,
        rx: 10,
        ry: 10
      });
    } else if (shape === "circle") {
      obj = new fabric.Circle({
        left: 110,
        top: 110,
        radius: 80,
        fill: "transparent",
        stroke: shapeColor,
        strokeWidth: 4
      });
    } else if (shape === "triangle") {
      obj = new fabric.Triangle({
        left: 120,
        top: 140,
        width: 160,
        height: 140,
        fill: "transparent",
        stroke: shapeColor,
        strokeWidth: 4
      });
    } else if (shape === "line") {
      obj = new fabric.Line([80, 80, 300, 200], {
        stroke: shapeColor,
        strokeWidth: 6
      });
    }

    if (!obj) {
      return;
    }

    canvas.add(obj);
    canvas.setActiveObject(obj);
    canvas.requestRenderAll();
    queueHistorySnapshot();
    syncSelectionState();
    setStatus(`Added ${shape}.`);
  }

  function addText() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    const textObj = new fabric.IText(textValue || "Type here", {
      left: 100,
      top: 120,
      fontSize: textSize,
      fill: textColor,
      fontFamily: "Trebuchet MS"
    });

    canvas.add(textObj);
    canvas.setActiveObject(textObj);
    canvas.requestRenderAll();
    queueHistorySnapshot();
    syncSelectionState();
    setStatus("Text added. Double-click text to edit.");
  }

  function getPrimaryImage() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const active = canvas.getActiveObject();
    if (active?.type === "image") {
      return active;
    }

    return canvas.getObjects().find((obj) => obj.type === "image") || null;
  }

  function applyFilters() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    const target = getPrimaryImage();
    if (!target) {
      setStatus("Select an image layer before applying filters.");
      return;
    }

    target.filters = [
      new fabric.Image.filters.Brightness({
        brightness: filterValues.brightness / 100
      }),
      new fabric.Image.filters.Contrast({
        contrast: filterValues.contrast / 100
      }),
      new fabric.Image.filters.Saturation({
        saturation: filterValues.saturation / 100
      }),
      new fabric.Image.filters.Blur({
        blur: filterValues.blur / 100
      })
    ];
    target.applyFilters();
    canvas.requestRenderAll();
    queueHistorySnapshot();
    setStatus("Filters applied.");
  }

  function resetFilters() {
    setFilterValues({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      blur: 0
    });
  }

  async function applyRectCrop() {
    const canvas = fabricCanvasRef.current;
    const rect = rectDraftRef.current;
    if (!canvas || !rect) {
      setStatus("Draw a crop rectangle first.");
      return;
    }

    const left = clamp(Math.round(rect.left || 0), 0, canvas.getWidth() - 1);
    const top = clamp(Math.round(rect.top || 0), 0, canvas.getHeight() - 1);
    const width = clamp(
      Math.round(rect.getScaledWidth()),
      1,
      canvas.getWidth() - left
    );
    const height = clamp(
      Math.round(rect.getScaledHeight()),
      1,
      canvas.getHeight() - top
    );

    if (width < 5 || height < 5) {
      setStatus("Crop area is too small.");
      return;
    }

    clearRectDraft();
    penPointsRef.current = [];
    clearPenGuide();

    try {
      const dataUrl = canvas.toDataURL({
        format: "png",
        left,
        top,
        width,
        height,
        multiplier: 1,
        enableRetinaScaling: false
      });
      const cropped = await createFabricImage(dataUrl);
      pauseHistoryRef.current = true;
      canvas.clear();
      canvas.setWidth(width);
      canvas.setHeight(height);
      cropped.set({
        left: 0,
        top: 0,
        originX: "left",
        originY: "top"
      });
      canvas.add(cropped);
      canvas.setActiveObject(cropped);
      canvas.requestRenderAll();
      setStatus("Rectangle crop applied.");
      syncSelectionState();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Crop failed.");
    } finally {
      pauseHistoryRef.current = false;
      saveHistorySnapshot();
    }
  }

  async function applyPenCrop() {
    const canvas = fabricCanvasRef.current;
    const points = [...penPointsRef.current];
    if (!canvas) {
      return;
    }

    if (points.length < MIN_PEN_POINTS) {
      setStatus("Add at least 3 points for pen crop.");
      return;
    }

    const minX = clamp(
      Math.floor(Math.min(...points.map((p) => p.x))),
      0,
      canvas.getWidth() - 1
    );
    const maxX = clamp(
      Math.ceil(Math.max(...points.map((p) => p.x))),
      1,
      canvas.getWidth()
    );
    const minY = clamp(
      Math.floor(Math.min(...points.map((p) => p.y))),
      0,
      canvas.getHeight() - 1
    );
    const maxY = clamp(
      Math.ceil(Math.max(...points.map((p) => p.y))),
      1,
      canvas.getHeight()
    );
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    clearPenGuide();
    penPointsRef.current = [];
    clearRectDraft();

    try {
      const fullDataUrl = canvas.toDataURL({
        format: "png",
        multiplier: 1,
        enableRetinaScaling: false
      });
      const sourceImage = await createHtmlImage(fullDataUrl);
      const offscreen = document.createElement("canvas");
      offscreen.width = width;
      offscreen.height = height;
      const ctx = offscreen.getContext("2d");

      if (!ctx) {
        throw new Error("Canvas context is unavailable.");
      }

      ctx.save();
      ctx.beginPath();
      points.forEach((point, index) => {
        const px = point.x - minX;
        const py = point.y - minY;
        if (index === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(sourceImage, -minX, -minY);
      ctx.restore();

      const croppedDataUrl = offscreen.toDataURL("image/png");
      const cropped = await createFabricImage(croppedDataUrl);
      pauseHistoryRef.current = true;
      canvas.clear();
      canvas.setWidth(width);
      canvas.setHeight(height);
      cropped.set({
        left: 0,
        top: 0,
        originX: "left",
        originY: "top"
      });
      canvas.add(cropped);
      canvas.setActiveObject(cropped);
      canvas.requestRenderAll();
      syncSelectionState();
      setStatus("Pen crop applied.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Pen crop failed.");
    } finally {
      pauseHistoryRef.current = false;
      saveHistorySnapshot();
    }
  }

  function rotateSelection(delta) {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      setStatus("Select an element to rotate.");
      return;
    }

    active.rotate((active.angle || 0) + delta);
    active.setCoords();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }

  function flipSelection(axis) {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      setStatus("Select an element to flip.");
      return;
    }

    if (axis === "x") {
      active.set("flipX", !active.flipX);
    } else {
      active.set("flipY", !active.flipY);
    }
    active.setCoords();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }

  function scaleSelection(scalePercent) {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      return;
    }

    const scale = clamp(scalePercent / 100, 0.05, 10);
    active.set({
      scaleX: scale,
      scaleY: scale
    });
    active.setCoords();
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }

  function cloneSelection() {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      setStatus("Select an element to clone.");
      return;
    }

    active.clone((cloned) => {
      cloned.set({
        left: (active.left || 0) + 24,
        top: (active.top || 0) + 24
      });
      canvas.add(cloned);
      canvas.setActiveObject(cloned);
      canvas.requestRenderAll();
      queueHistorySnapshot();
      syncSelectionState();
    });
  }

  function deleteSelection() {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      return;
    }
    canvas.remove(active);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    queueHistorySnapshot();
    syncSelectionState();
  }

  function bringSelectionForward() {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      return;
    }
    canvas.bringForward(active);
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }

  function sendSelectionBackward() {
    const canvas = fabricCanvasRef.current;
    const active = canvas?.getActiveObject();
    if (!canvas || !active) {
      return;
    }
    canvas.sendBackwards(active);
    canvas.requestRenderAll();
    queueHistorySnapshot();
  }

  function clearCanvas() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }
    pauseHistoryRef.current = true;
    canvas.clear();
    canvas.setWidth(960);
    canvas.setHeight(640);
    pauseHistoryRef.current = false;
    saveHistorySnapshot();
    syncSelectionState();
    setStatus("Canvas cleared.");
  }

  async function pasteFromClipboardButton() {
    if (!navigator.clipboard?.read) {
      setStatus("Clipboard image access is not available in this browser.");
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) {
          continue;
        }
        const blob = await item.getType(imageType);
        const file = new File([blob], "clipboard-image.png", { type: imageType });
        await loadImageFile(file, false);
        return;
      }
      setStatus("No image found in clipboard.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to read clipboard image."
      );
    }
  }

  function downloadImage() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    clearRectDraft();
    clearPenGuide();
    const dataUrl = canvas.toDataURL({
      format: downloadFormat,
      quality: downloadFormat === "jpeg" ? 0.95 : 1,
      multiplier: 1,
      enableRetinaScaling: false
    });
    const anchor = document.createElement("a");
    anchor.href = dataUrl;
    anchor.download = `edited-${Date.now()}.${downloadFormat}`;
    anchor.click();
    setStatus(`Downloaded ${downloadFormat.toUpperCase()} image.`);
  }

  async function removeBackgroundViaApi() {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }

    if (!removeBgEndpoint.trim()) {
      setStatus("Please provide an API endpoint for background removal.");
      return;
    }

    try {
      setStatus("Sending image to background removal API...");
      const sourceDataUrl = canvas.toDataURL({
        format: "png",
        multiplier: 1,
        enableRetinaScaling: false
      });
      const sourceBlob = dataUrlToBlob(sourceDataUrl);
      const form = new FormData();
      form.append("file", sourceBlob, "editor-image.png");

      const response = await fetch(removeBgEndpoint.trim(), {
        method: "POST",
        body: form
      });
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      const resultBlob = await response.blob();
      const resultFile = new File([resultBlob], "removed-background.png", {
        type: resultBlob.type || "image/png"
      });
      await loadImageFile(resultFile, true);
      setStatus("Background removed by API response.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Background removal request failed."
      );
    }
  }

  function handleReplaceInput(event) {
    const file = event.target.files?.[0];
    if (file) {
      loadImageFile(file, true);
    }
    event.target.value = "";
  }

  function handleLayerInput(event) {
    const file = event.target.files?.[0];
    if (file) {
      loadImageFile(file, false);
    }
    event.target.value = "";
  }

  function onDragOver(event) {
    event.preventDefault();
    setDropActive(true);
  }

  function onDragLeave(event) {
    event.preventDefault();
    setDropActive(false);
  }

  function onDrop(event) {
    event.preventDefault();
    setDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      loadImageFile(file, true);
    }
  }

  useEffect(() => {
    const canvas = new fabric.Canvas(canvasNodeRef.current, {
      width: 960,
      height: 640,
      backgroundColor: "rgba(0,0,0,0)",
      preserveObjectStacking: true,
      selection: true
    });

    fabricCanvasRef.current = canvas;

    const historyEventHandler = () => queueHistorySnapshot();
    const selectionEventHandler = () => syncSelectionState();

    const pathEventHandler = (event) => {
      if (toolModeRef.current === "erase" && event.path) {
        event.path.globalCompositeOperation = "destination-out";
        event.path.stroke = "#000000";
      }
      queueHistorySnapshot();
    };

    const mouseDownHandler = (event) => {
      if (!event.e) {
        return;
      }
      const pointer = canvas.getPointer(event.e);

      if (toolModeRef.current === "rectCrop") {
        clearRectDraft();
        rectStartRef.current = pointer;
        pauseHistoryRef.current = true;
        const draft = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 1,
          height: 1,
          fill: "rgba(245, 170, 66, 0.15)",
          stroke: "#f5aa42",
          strokeWidth: 2,
          strokeDashArray: [8, 5],
          selectable: false,
          evented: false
        });
        draft.excludeFromExport = true;
        rectDraftRef.current = draft;
        canvas.add(draft);
        draft.bringToFront();
        pauseHistoryRef.current = false;
        canvas.requestRenderAll();
      } else if (toolModeRef.current === "penCrop") {
        penPointsRef.current = [...penPointsRef.current, pointer];
        drawPenGuide();
      }
    };

    const mouseMoveHandler = (event) => {
      if (toolModeRef.current !== "rectCrop") {
        return;
      }

      if (!rectStartRef.current || !rectDraftRef.current || !event.e) {
        return;
      }

      const pointer = canvas.getPointer(event.e);
      const start = rectStartRef.current;
      const left = Math.min(start.x, pointer.x);
      const top = Math.min(start.y, pointer.y);
      const width = Math.abs(pointer.x - start.x);
      const height = Math.abs(pointer.y - start.y);

      rectDraftRef.current.set({
        left,
        top,
        width,
        height
      });
      canvas.requestRenderAll();
    };

    const mouseUpHandler = () => {
      rectStartRef.current = null;
    };

    canvas.on("object:added", historyEventHandler);
    canvas.on("object:removed", historyEventHandler);
    canvas.on("object:modified", historyEventHandler);
    canvas.on("path:created", pathEventHandler);
    canvas.on("selection:created", selectionEventHandler);
    canvas.on("selection:updated", selectionEventHandler);
    canvas.on("selection:cleared", selectionEventHandler);
    canvas.on("mouse:down", mouseDownHandler);
    canvas.on("mouse:move", mouseMoveHandler);
    canvas.on("mouse:up", mouseUpHandler);

    saveHistorySnapshot();
    syncSelectionState();

    return () => {
      if (historyDebounceTimerRef.current) {
        clearTimeout(historyDebounceTimerRef.current);
      }
      canvas.off("object:added", historyEventHandler);
      canvas.off("object:removed", historyEventHandler);
      canvas.off("object:modified", historyEventHandler);
      canvas.off("path:created", pathEventHandler);
      canvas.off("selection:created", selectionEventHandler);
      canvas.off("selection:updated", selectionEventHandler);
      canvas.off("selection:cleared", selectionEventHandler);
      canvas.off("mouse:down", mouseDownHandler);
      canvas.off("mouse:move", mouseMoveHandler);
      canvas.off("mouse:up", mouseUpHandler);
      canvas.dispose();
      fabricCanvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) {
      return;
    }
    const drawing = toolMode === "draw" || toolMode === "erase";
    canvas.isDrawingMode = drawing;
    if (drawing) {
      const brush = canvas.freeDrawingBrush || new fabric.PencilBrush(canvas);
      brush.width = brushSize;
      brush.color = toolMode === "erase" ? "#000000" : brushColor;
      canvas.freeDrawingBrush = brush;
    }
  }, [toolMode, brushSize, brushColor]);

  useEffect(() => {
    const pasteHandler = async (event) => {
      const items = event.clipboardData?.items || [];
      for (const item of items) {
        if (!item.type.startsWith("image/")) {
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          await loadImageFile(file, false);
          return;
        }
      }
    };

    const keyHandler = (event) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const cmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;
      const key = event.key.toLowerCase();

      if (cmdOrCtrl && key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }

      if (
        (cmdOrCtrl && key === "y") ||
        (cmdOrCtrl && event.shiftKey && key === "z")
      ) {
        event.preventDefault();
        redo();
        return;
      }

      if (key === "delete" || key === "backspace") {
        const target = event.target;
        const tag = target instanceof HTMLElement ? target.tagName : "";
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          deleteSelection();
        }
        return;
      }

      if (key === "escape") {
        clearRectDraft();
        penPointsRef.current = [];
        clearPenGuide();
        setToolMode("select");
        setStatus("Selection tool enabled.");
      }
    };

    window.addEventListener("paste", pasteHandler);
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("paste", pasteHandler);
      window.removeEventListener("keydown", keyHandler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo]);

  const modeButtons = [
    { id: "select", label: "Select / Move" },
    { id: "draw", label: "Draw Brush" },
    { id: "erase", label: "Erase Brush" },
    { id: "rectCrop", label: "Rect Crop" },
    { id: "penCrop", label: "Pen Crop" }
  ];

  return (
    <div className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <header className="top-bar card reveal-down">
        <div>
          <p className="eyebrow">Background Remover Studio</p>
          <h1>Photo Forge Editor</h1>
          <p className="subhead">
            Upload, crop, rotate, transform, draw, paste, and export photos.
          </p>
        </div>
        <div className="top-actions">
          <button onClick={() => replaceInputRef.current?.click()}>Upload Photo</button>
          <button onClick={() => layerInputRef.current?.click()}>Add Layer</button>
          <button onClick={pasteFromClipboardButton}>Paste</button>
          <button onClick={undo} disabled={!canUndo}>
            Undo
          </button>
          <button onClick={redo} disabled={!canRedo}>
            Redo
          </button>
          <button className="primary" onClick={downloadImage}>
            Download
          </button>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            onChange={handleReplaceInput}
            hidden
          />
          <input
            ref={layerInputRef}
            type="file"
            accept="image/*"
            onChange={handleLayerInput}
            hidden
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="card panel reveal-up">
          <h2>Tools</h2>
          <div className="button-grid">
            {modeButtons.map((button) => (
              <button
                key={button.id}
                className={toolMode === button.id ? "active" : ""}
                onClick={() => switchTool(button.id)}
              >
                {button.label}
              </button>
            ))}
          </div>

          {(toolMode === "draw" || toolMode === "erase") ? (
            <>
              <label>
                Brush Size: {brushSize}px
                <input
                  type="range"
                  min="1"
                  max="120"
                  value={brushSize}
                  onChange={(event) => setBrushSize(Number(event.target.value))}
                />
              </label>
              {toolMode === "draw" ? (
                <label>
                  Brush Color
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(event) => setBrushColor(event.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {toolMode === "rectCrop" ? (
            <div className="inline-actions">
              <button className="primary" onClick={applyRectCrop}>
                Apply Crop
              </button>
              <button
                onClick={() => {
                  clearRectDraft();
                  setStatus("Rectangle crop canceled.");
                }}
              >
                Cancel
              </button>
            </div>
          ) : null}

          {toolMode === "penCrop" ? (
            <>
              <p className="hint">
                Click points around the subject. Press Apply Pen Crop when done.
              </p>
              <div className="inline-actions">
                <button className="primary" onClick={applyPenCrop}>
                  Apply Pen Crop
                </button>
                <button
                  onClick={() => {
                    penPointsRef.current = [];
                    clearPenGuide();
                    setStatus("Pen crop points cleared.");
                  }}
                >
                  Reset Points
                </button>
              </div>
            </>
          ) : null}

          <h3>Draw Shapes</h3>
          <label>
            Shape Color
            <input
              type="color"
              value={shapeColor}
              onChange={(event) => setShapeColor(event.target.value)}
            />
          </label>
          <div className="button-grid">
            <button onClick={() => addShape("rect")}>Rectangle</button>
            <button onClick={() => addShape("circle")}>Circle</button>
            <button onClick={() => addShape("triangle")}>Triangle</button>
            <button onClick={() => addShape("line")}>Line</button>
          </div>

          <h3>Text</h3>
          <label>
            Text Value
            <input
              type="text"
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
            />
          </label>
          <label>
            Text Size: {textSize}px
            <input
              type="range"
              min="10"
              max="160"
              value={textSize}
              onChange={(event) => setTextSize(Number(event.target.value))}
            />
          </label>
          <label>
            Text Color
            <input
              type="color"
              value={textColor}
              onChange={(event) => setTextColor(event.target.value)}
            />
          </label>
          <button onClick={addText}>Add Text</button>
        </aside>

        <main className="stage-column reveal-up">
          <div
            className={`canvas-host card ${dropActive ? "drop-active" : ""}`}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragLeave={onDragLeave}
          >
            <canvas ref={canvasNodeRef} />
          </div>
          <div className="status-bar card">
            <span>{status}</span>
            <span>
              Selection: <strong>{hasSelection ? selectionType : "none"}</strong>
            </span>
          </div>
          <p className="hint keyboard">
            Shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Delete removes
            selection, Esc exits crop modes, Ctrl/Cmd+V pastes image from
            clipboard.
          </p>
        </main>

        <aside className="card panel reveal-up delay">
          <h2>Transform</h2>
          <div className="inline-actions">
            <button onClick={() => rotateSelection(-90)}>Rotate -90 deg</button>
            <button onClick={() => rotateSelection(90)}>Rotate +90 deg</button>
          </div>
          <label>
            Scale Selection
            <input
              type="range"
              min="10"
              max="350"
              defaultValue="100"
              onChange={(event) => scaleSelection(Number(event.target.value))}
            />
          </label>
          <div className="inline-actions">
            <button onClick={() => flipSelection("x")}>Flip X</button>
            <button onClick={() => flipSelection("y")}>Flip Y</button>
          </div>
          <div className="inline-actions">
            <button onClick={bringSelectionForward}>Bring Forward</button>
            <button onClick={sendSelectionBackward}>Send Back</button>
          </div>
          <div className="inline-actions">
            <button onClick={cloneSelection}>Duplicate</button>
            <button onClick={deleteSelection}>Delete</button>
          </div>

          <h3>Image Filters</h3>
          <label>
            Brightness: {filterValues.brightness}
            <input
              type="range"
              min="-100"
              max="100"
              value={filterValues.brightness}
              onChange={(event) =>
                setFilterValues((prev) => ({
                  ...prev,
                  brightness: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Contrast: {filterValues.contrast}
            <input
              type="range"
              min="-100"
              max="100"
              value={filterValues.contrast}
              onChange={(event) =>
                setFilterValues((prev) => ({
                  ...prev,
                  contrast: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Saturation: {filterValues.saturation}
            <input
              type="range"
              min="-100"
              max="100"
              value={filterValues.saturation}
              onChange={(event) =>
                setFilterValues((prev) => ({
                  ...prev,
                  saturation: Number(event.target.value)
                }))
              }
            />
          </label>
          <label>
            Blur: {filterValues.blur}
            <input
              type="range"
              min="0"
              max="100"
              value={filterValues.blur}
              onChange={(event) =>
                setFilterValues((prev) => ({
                  ...prev,
                  blur: Number(event.target.value)
                }))
              }
            />
          </label>
          <div className="inline-actions">
            <button className="primary" onClick={applyFilters}>
              Apply Filters
            </button>
            <button onClick={resetFilters}>Reset Sliders</button>
          </div>

          <h3>Background API</h3>
          <label>
            Endpoint URL
            <input
              type="text"
              value={removeBgEndpoint}
              onChange={(event) => setRemoveBgEndpoint(event.target.value)}
              placeholder="http://localhost:8000/remove-background"
            />
          </label>
          <button onClick={removeBackgroundViaApi}>Remove BG via API</button>

          <h3>Export</h3>
          <label>
            File Type
            <select
              value={downloadFormat}
              onChange={(event) => setDownloadFormat(event.target.value)}
            >
              <option value="png">PNG (transparent support)</option>
              <option value="jpeg">JPEG</option>
            </select>
          </label>
          <div className="inline-actions">
            <button className="primary" onClick={downloadImage}>
              Download Image
            </button>
            <button onClick={clearCanvas}>Clear Canvas</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
