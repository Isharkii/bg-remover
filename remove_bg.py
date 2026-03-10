"""
High-quality background remover.
Uses rembg ISNet model with edge-aware mask refinement for detail preservation.
"""

import sys
from pathlib import Path
from typing import Any, Optional

import cv2
import numpy as np
from PIL import Image
from rembg import new_session, remove

DEFAULT_MODEL_NAME = "isnet-general-use"
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}


def create_session(model_name: str = DEFAULT_MODEL_NAME) -> Any:
    """Create a rembg session for repeated image processing."""
    return new_session(model_name)


def refine_mask(image_np: np.ndarray, mask_np: np.ndarray) -> np.ndarray:
    """
    Refine mask to remove white halo while preserving detail.
    Strategy: threshold to remove soft fringe, then smooth only edge band.
    """
    _ = image_np  # Reserved for future guided operations.

    # 1) Hard threshold removes soft semi-transparent fringe.
    _, hard_mask = cv2.threshold(mask_np, 128, 255, cv2.THRESH_BINARY)

    # 2) Erode 1px to cut outer halo.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    eroded = cv2.erode(hard_mask, kernel, iterations=1)

    # 3) Smooth only edge band to avoid jagged boundaries.
    blurred = cv2.GaussianBlur(eroded, (3, 3), 0.8)

    # 4) Keep interior opaque, use blur only near edges.
    dilated = cv2.dilate(eroded, kernel, iterations=1)
    edge_band = dilated.astype(np.int16) - eroded.astype(np.int16)
    edge_band = np.clip(edge_band, 0, 255).astype(np.uint8)
    is_edge = edge_band > 0

    result = eroded.copy()
    result[is_edge] = blurred[is_edge]
    return result


def remove_background_image(
    image: Image.Image,
    model_name: str = DEFAULT_MODEL_NAME,
    session: Optional[Any] = None,
) -> Image.Image:
    """
    Remove background from a PIL image and return RGBA output.
    """
    rgb_img = image.convert("RGB")
    active_session = session or create_session(model_name)

    # Get raw removal at full resolution; no alpha matting to avoid blur.
    result = remove(
        rgb_img,
        session=active_session,
        alpha_matting=False,
        post_process_mask=True,
    )

    # Extract and refine alpha mask.
    raw_mask = np.array(result.split()[-1])
    image_np = np.array(rgb_img)
    try:
        refined_mask = refine_mask(image_np, raw_mask)
    except (cv2.error, AttributeError):
        refined_mask = raw_mask

    # Apply refined alpha to original pixels.
    output = Image.fromarray(image_np).convert("RGBA")
    output.putalpha(Image.fromarray(refined_mask))
    return output


def remove_background(
    input_path: str,
    output_dir: str,
    model_name: str = DEFAULT_MODEL_NAME,
    session: Optional[Any] = None,
):
    """Remove background from a single image and save lossless PNG."""
    input_path_obj = Path(input_path)
    output_dir_obj = Path(output_dir)
    output_dir_obj.mkdir(parents=True, exist_ok=True)

    if input_path_obj.suffix.lower() not in SUPPORTED_EXTENSIONS:
        print(f"Skipping unsupported file: {input_path_obj}")
        return None

    img = Image.open(input_path_obj)
    original_size = img.size
    print(f"Processing: {input_path_obj.name} ({original_size[0]}x{original_size[1]})")

    output = remove_background_image(
        img,
        model_name=model_name,
        session=session,
    )

    output_name = input_path_obj.stem + "_nobg.png"
    output_path = output_dir_obj / output_name
    output.save(str(output_path), format="PNG", compress_level=1)

    print(f"Saved: {output_path} ({output.size[0]}x{output.size[1]})")
    return output_path


def process_directory(
    input_dir: str,
    output_dir: str,
    model_name: str = DEFAULT_MODEL_NAME,
):
    """Process all supported images in a directory."""
    input_dir_obj = Path(input_dir)
    results = []
    shared_session = create_session(model_name)
    for file in sorted(input_dir_obj.iterdir()):
        if file.is_file() and file.suffix.lower() in SUPPORTED_EXTENSIONS:
            result = remove_background(
                str(file),
                output_dir,
                model_name=model_name,
                session=shared_session,
            )
            if result:
                results.append(result)
    return results


if __name__ == "__main__":
    script_dir = Path(__file__).parent
    output_dir = script_dir / "output"

    if len(sys.argv) > 1:
        session = create_session(DEFAULT_MODEL_NAME)
        for arg in sys.argv[1:]:
            p = Path(arg)
            if p.is_file():
                remove_background(
                    str(p),
                    str(output_dir),
                    model_name=DEFAULT_MODEL_NAME,
                    session=session,
                )
            elif p.is_dir():
                process_directory(
                    str(p),
                    str(output_dir),
                    model_name=DEFAULT_MODEL_NAME,
                )
            else:
                print(f"Not found: {arg}")
    else:
        print("No arguments provided. Processing all images in current directory...")
        process_directory(str(script_dir), str(output_dir), model_name=DEFAULT_MODEL_NAME)

    print("\nDone! Check the 'output' folder for results.")
