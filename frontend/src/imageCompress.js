// Client-side image compression before upload.
// Pure browser APIs only (Canvas/OffscreenCanvas, createImageBitmap) — no dependencies.
// Never throws: on any failure (unsupported API, decode error, bigger output, etc.)
// it falls back to returning the original file so an upload is never blocked.

// Map a target mime type to a matching file extension.
function extensionForMime(mime) {
  if (mime === "image/webp") return "webp";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  // Fallback: take whatever comes after "image/"
  const match = /^image\/([a-z0-9]+)$/i.exec(mime || "");
  return match ? match[1] : "img";
}

// Swap (or append) the extension on a filename to match the compressed mime type.
function renameForMime(name, mime) {
  const ext = extensionForMime(mime);
  const dotIndex = name.lastIndexOf(".");
  const base = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  return `${base}.${ext}`;
}

// Decode a File/Blob into something drawable on a canvas.
// Prefers createImageBitmap (fast, off-main-thread capable, honors EXIF orientation).
// Falls back to loading an <img> from an object URL when createImageBitmap is unavailable.
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image for compression."));
    });
    img.src = objectUrl;
    return await loaded;
  } finally {
    // Revoking immediately is safe: the <img> has already decoded pixel data by
    // the time `loaded` resolves, and canvas drawing below doesn't need the URL.
    URL.revokeObjectURL(objectUrl);
  }
}

// Get natural pixel dimensions from either an ImageBitmap or an HTMLImageElement.
function getDimensions(image) {
  const width = image.width ?? image.naturalWidth;
  const height = image.height ?? image.naturalHeight;
  return { width, height };
}

// Draw the decoded image onto a canvas sized to (targetWidth, targetHeight) and
// export it as a Blob in the requested mime/quality. Uses OffscreenCanvas when
// available (works in workers too), otherwise a regular <canvas> element.
async function drawAndEncode(image, targetWidth, targetHeight, mime, quality) {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas.convertToBlob({ type: mime, quality });
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas failed to produce a blob."));
      },
      mime,
      quality
    );
  });
}

/**
 * Compress an image file client-side before upload.
 *
 * @param {File} file - The original file selected/dropped by the user.
 * @param {object} [options]
 * @param {number} [options.maxDim=1600] - Longest side (px) to scale down to; never upscales.
 * @param {number} [options.quality=0.8] - Encoder quality, 0..1.
 * @param {string} [options.mime='image/webp'] - Target mime type for the re-encoded image.
 * @returns {Promise<File|Blob>} The compressed file, or the original file if compression
 *   isn't applicable, doesn't help, or fails for any reason.
 */
export async function compressImage(file, { maxDim = 1600, quality = 0.8, mime = "image/webp" } = {}) {
  // Not an image at all — nothing to do.
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
    return file;
  }

  try {
    const image = await decodeImage(file);
    const { width, height } = getDimensions(image);

    if (!width || !height) {
      return file;
    }

    // Scale so the longest side is at most maxDim; never upscale smaller images.
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const blob = await drawAndEncode(image, targetWidth, targetHeight, mime, quality);

    // Release ImageBitmap resources if applicable.
    if (typeof image.close === "function") {
      image.close();
    }

    if (!blob || blob.size >= file.size) {
      // Compression didn't actually shrink the file — keep the original.
      return file;
    }

    const newName = renameForMime(file.name || "image", blob.type || mime);

    if (typeof File === "function") {
      try {
        return new File([blob], newName, { type: blob.type || mime });
      } catch {
        return blob;
      }
    }

    return blob;
  } catch {
    // Any failure along the way: decode error, canvas error, unsupported API, etc.
    // Never block the upload — fall back to the original file.
    return file;
  }
}
