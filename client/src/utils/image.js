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

export async function blobToJpeg(blob) {
  if (blob.type === "image/jpeg") return blob;

  const drawWithBitmap = async () => {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d", { alpha: false }).drawImage(bmp, 0, 0);
    const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (bmp.close) bmp.close();
    return jpegBlob || blob;
  };

  if (window.createImageBitmap) {
    try {
      return await drawWithBitmap();
    } catch {
      // fallback below
    }
  }

  // Fallback via Image element
  const url = URL.createObjectURL(blob);
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
  const jpegBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  URL.revokeObjectURL(url);
  return jpegBlob || blob;
}

export async function blobToPng(blob) {
  if (blob.type === "image/png") return blob;
  const drawWithBitmap = async () => {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d", { alpha: false }).drawImage(bmp, 0, 0);
    const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (bmp.close) bmp.close();
    return pngBlob || blob;
  };
  if (window.createImageBitmap) {
    try {
      return await drawWithBitmap();
    } catch {
      // fallback below
    }
  }
  const url = URL.createObjectURL(blob);
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
  const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  URL.revokeObjectURL(url);
  return pngBlob || blob;
}

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
