import { useCallback, useState } from "react";
import { toBlob } from "../utils/image";
import { encryptDataUrl } from "../utils/crypto";

export function useClipboardShare({ sessionKey, showCopyStatus, sendPhotoSecure, setLightboxSrc }) {
  const [clipboardPreview, setClipboardPreview] = useState(null);
  const [clipboardMode, setClipboardMode] = useState(false);

  const copyImageToClipboard = useCallback(
    async (src) => {
      const supportsImageClipboard = !!(navigator.clipboard?.write && window.ClipboardItem);
      try {
        if (supportsImageClipboard) {
          const tryWrite = async (blob, label) => {
            if (!blob) throw new Error("Kein Bild");
            const type = blob.type || "image/jpeg";
            const item = new ClipboardItem({ [type]: blob });
            await navigator.clipboard.write([item]);
            showCopyStatus(`${label} kopiert`);
          };

          try {
            const jpeg = await toBlob(src, "jpeg");
            await tryWrite(jpeg, "JPEG");
            return;
          } catch (errJpeg) {
            console.warn("JPEG-Clipboard fehlgeschlagen, versuche PNG:", errJpeg);
            const png = await toBlob(src, "png");
            await tryWrite(png, "PNG");
            return;
          }
        }
      } catch (err) {
        console.warn("Bild-Clipboard fehlgeschlagen, falle zurueck auf Text:", err);
      }
      try {
        await navigator.clipboard.writeText(src);
        showCopyStatus(
          supportsImageClipboard
            ? "Link kopiert (Bild-Clipboard blockiert)"
            : "Link kopiert (Bild-Clipboard nicht unterstuetzt)"
        );
      } catch {
        showCopyStatus("Kopieren nicht moeglich");
      }
    },
    [showCopyStatus]
  );

  const copyPlainUrl = useCallback(
    async (src) => {
      try {
        await navigator.clipboard.writeText(src);
        showCopyStatus("Data-URL kopiert");
      } catch (err) {
        console.warn("Plain copy failed", err);
        showCopyStatus("Kopieren nicht moeglich");
      }
    },
    [showCopyStatus]
  );

  const copyEncrypted = useCallback(
    async (src) => {
      if (!sessionKey) {
        showCopyStatus("Kein Key - verschluesselt nicht kopiert");
        return;
      }
      try {
        const payload = await encryptDataUrl(src, sessionKey);
        await navigator.clipboard.writeText(JSON.stringify(payload));
        showCopyStatus("Verschluesselt kopiert");
      } catch (err) {
        console.warn("Encrypted copy failed", err);
        showCopyStatus("Verschluesseltes Kopieren fehlgeschlagen");
      }
    },
    [sessionKey, showCopyStatus]
  );

  const saveImage = useCallback(
    async (src) => {
      try {
        let blob = null;
        try {
          blob = await toBlob(src, "jpeg");
        } catch {
          blob = await toBlob(src, "png");
        }
        if (!blob) throw new Error("Kein Bild");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ext = blob.type === "image/png" ? "png" : "jpg";
        a.href = url;
        a.download = `photo-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn("Speichern fehlgeschlagen:", err);
        showCopyStatus("Speichern nicht moeglich");
      }
    },
    [showCopyStatus]
  );

  const fileToDataUrl = useCallback(
    (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
    []
  );

  const handleDesktopClipboardLoad = useCallback(async () => {
    try {
      if (!navigator.clipboard?.read) {
        showCopyStatus("Bild-Clipboard nicht unterstuetzt");
        return;
      }

      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (!imgType) continue;

        const blob = await item.getType(imgType);
        if (!blob?.type?.startsWith("image/")) continue;

        const dataUrl = await fileToDataUrl(blob);
        if (!dataUrl) continue;

        setClipboardPreview({ type: "image", data: dataUrl });
        setLightboxSrc?.(dataUrl);
        setClipboardMode(true);
        showCopyStatus("Clipboard geladen", 1200);
        return;
      }

      showCopyStatus("Keine Bilddaten im Clipboard");
    } catch (err) {
      console.warn("Clipboard read failed", err);
      showCopyStatus("Clipboard nicht lesbar");
    }
  }, [fileToDataUrl, setLightboxSrc, showCopyStatus]);

  const handleDesktopClipboardSend = useCallback(async () => {
    if (!clipboardPreview) return;
    try {
      await sendPhotoSecure(clipboardPreview.data);
      showCopyStatus("Clipboard-Bild gesendet", 1200);
      setClipboardPreview(null);
      setClipboardMode(false);
      setLightboxSrc?.(null);
    } catch (err) {
      console.warn("Clipboard send failed", err);
      showCopyStatus("Senden fehlgeschlagen");
    }
  }, [clipboardPreview, sendPhotoSecure, setLightboxSrc, showCopyStatus]);

  const discardClipboardPreview = useCallback(() => {
    setClipboardPreview(null);
    setClipboardMode(false);
    setLightboxSrc?.(null);
  }, [setLightboxSrc]);

  return {
    clipboardPreview,
    setClipboardPreview,
    clipboardMode,
    copyImageToClipboard,
    copyPlainUrl,
    copyEncrypted,
    saveImage,
    handleDesktopClipboardLoad,
    handleDesktopClipboardSend,
    discardClipboardPreview,
  };
}
