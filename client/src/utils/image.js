/**
 * Image Conversion Utilities
 * Provides functions for converting between data URLs, blobs, and image formats
 */

/**
 * Convert a data URL to a Blob
 * @param {string} dataUrl - The data URL to convert
 * @returns {Blob|null} The resulting Blob or null if invalid
 */
export function dataUrlToBlob(dataUrl) {
  const arr = dataUrl.split(",");
  if (arr.length < 2) return null;
  const mimeMatch = arr[0].match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8arr[i] = bstr.charCodeAt(i);
  return new Blob([u8arr], { type: mime });
}

/**
 * Convert a blob to a specified image format using canvas
 * @param {Blob} blob - The source blob
 * @param {string} format - Target format ('jpeg' or 'png')
 * @param {number} [quality=0.92] - JPEG quality (0-1), ignored for PNG
 * @returns {Promise<Blob>} The converted blob
 */
async function convertBlobToFormat(blob, format, quality = 0.92) {
  const mimeType = `image/${format}`;

  // Try modern createImageBitmap first
  if (window.createImageBitmap) {
    try {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d", { alpha: false }).drawImage(bmp, 0, 0);
      const convertedBlob = await new Promise((resolve) =>
        canvas.toBlob(resolve, mimeType, format === "jpeg" ? quality : undefined)
      );
      if (bmp.close) bmp.close();
      return convertedBlob || blob;
    } catch {
      // Fall through to Image element fallback
    }
  }

  // Fallback via Image element for older browsers
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d", { alpha: false }).drawImage(img, 0, 0);
    const convertedBlob = await new Promise((resolve) =>
      canvas.toBlob(resolve, mimeType, format === "jpeg" ? quality : undefined)
    );
    return convertedBlob || blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert a blob to JPEG format
 * @param {Blob} blob - The source blob
 * @param {number} [quality=0.92] - JPEG quality (0-1)
 * @returns {Promise<Blob>} The JPEG blob
 */
export async function blobToJpeg(blob, quality = 0.92) {
  if (blob.type === "image/jpeg") return blob;
  return convertBlobToFormat(blob, "jpeg", quality);
}

/**
 * Convert a blob to PNG format
 * @param {Blob} blob - The source blob
 * @returns {Promise<Blob>} The PNG blob
 */
export async function blobToPng(blob) {
  if (blob.type === "image/png") return blob;
  return convertBlobToFormat(blob, "png");
}

/**
 * Convert an image source (data URL or URL) to a blob in the preferred format
 * @param {string} src - Data URL or regular URL
 * @param {'jpeg'|'png'} [prefer='jpeg'] - Preferred output format
 * @returns {Promise<Blob|null>} The converted blob or null on failure
 */
export async function toBlob(src, prefer = "jpeg") {
  let blob = null;
  if (src.startsWith("data:")) {
    blob = dataUrlToBlob(src);
  } else {
    const res = await fetch(src);
    blob = await res.blob();
  }
  if (!blob) return null;
  if (prefer === "jpeg") return await blobToJpeg(blob);
  if (prefer === "png") return await blobToPng(blob);
  return blob;
}
