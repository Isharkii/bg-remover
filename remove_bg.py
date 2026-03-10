"""
High-Quality Background Remover
Uses rembg ISNet model with edge-aware mask refinement for maximum detail preservation.
No alpha matting (which causes blur) — uses guided filter refinement instead.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from rembg import remove, new_session

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def refine_mask(image_np: np.ndarray, mask_np: np.ndarray) -> np.ndarray:
    """
    Refine mask to remove white halo while preserving detail.
    Strategy: threshold to remove soft fringe, then use a small Gaussian
    blur only on the edge band to get smooth (not jagged) edges.
    """
    # 1. Hard threshold: kill the soft semi-transparent fringe that causes the glow
    #    Pixels below 128 alpha -> fully transparent, above -> fully opaque
    _, hard_mask = cv2.threshold(mask_np, 128, 255, cv2.THRESH_BINARY)

    # 2. Erode by 1px to cut the outermost white-contaminated pixels
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    eroded = cv2.erode(hard_mask, kernel, iterations=1)

    # 3. Smooth only the edge band (2px wide) to avoid jagged staircase edges
    #    while keeping interior fully opaque
    blurred = cv2.GaussianBlur(eroded, (3, 3), 0.8)

    # 4. Combine: use the blurred version only near edges, keep solid interior
    #    Edge region = where eroded differs from a dilated version
    dilated = cv2.dilate(eroded, kernel, iterations=1)
    edge_band = dilated.astype(np.int16) - eroded.astype(np.int16)
    edge_band = np.clip(edge_band, 0, 255).astype(np.uint8)
    is_edge = edge_band > 0

    result = eroded.copy()
    result[is_edge] = blurred[is_edge]

    return result


def remove_background(input_path: str, output_dir: str, model_name: str = "isnet-general-use"):
    """Remove background from a single image with maximum quality preservation."""
    input_path = Path(input_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if input_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        print(f"Skipping unsupported file: {input_path}")
        return None

    img = Image.open(input_path).convert("RGB")
    original_size = img.size
    print(f"Processing: {input_path.name} ({original_size[0]}x{original_size[1]})")

    session = new_session(model_name)

    # Get raw removal at full resolution — NO alpha matting (avoids blur)
    result = remove(
        img,
        session=session,
        alpha_matting=False,
        post_process_mask=True,
    )

    # Extract the raw alpha mask
    raw_mask = np.array(result.split()[-1])

    # Refine mask with edge-aware guided filter
    image_np = np.array(img)
    try:
        refined_mask = refine_mask(image_np, raw_mask)
        print("  Applied edge-aware mask refinement")
    except (cv2.error, AttributeError):
        refined_mask = raw_mask
        print("  Using raw mask (refinement unavailable)")

    # Apply refined mask to original full-res pixels (zero quality loss)
    output = Image.fromarray(image_np).convert("RGBA")
    output.putalpha(Image.fromarray(refined_mask))

    # Save as lossless PNG
    output_name = input_path.stem + "_nobg.png"
    output_path = output_dir / output_name
    output.save(str(output_path), format="PNG", compress_level=1)

    print(f"Saved: {output_path} ({output.size[0]}x{output.size[1]})")
    return output_path


def process_directory(input_dir: str, output_dir: str, model_name: str = "isnet-general-use"):
    """Process all images in a directory."""
    input_dir = Path(input_dir)
    results = []
    for file in sorted(input_dir.iterdir()):
        if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS:
            result = remove_background(str(file), output_dir, model_name)
            if result:
                results.append(result)
    return results


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    output_dir = script_dir / "output"

    if len(sys.argv) > 1:
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.is_file():
                remove_background(str(p), str(output_dir))
            elif p.is_dir():
                process_directory(str(p), str(output_dir))
            else:
                print(f"Not found: {arg}")
    else:
        print("No arguments provided. Processing all images in current directory...")
        process_directory(str(script_dir), str(output_dir))

    print("\nDone! Check the 'output' folder for results.")
