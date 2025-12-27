import { useCallback, useState } from "react";
import { toBlob } from "../utils/image";
import { encryptDataUrl } from "../utils/crypto";

export function useClipboardShare({ sessionKey, showCopyStatus, sendPhotoSecure, setLightboxSrc, t }) {
  const [clipboardPreview, setClipboardPreview] = useState(null);
  const [clipboardMode, setClipboardMode] = useState(false);

  const copyImageToClipboard = useCallback(
    async (src) => {
      const supportsImageClipboard = !!(navigator.clipboard?.write && window.ClipboardItem);
      try {
        if (supportsImageClipboard) {
          const tryWrite = async (blob, format) => {
            if (!blob) throw new Error(t("clipboard.noImage"));
            const type = blob.type || "image/jpeg";
            const item = new ClipboardItem({ [type]: blob });
            await navigator.clipboard.write([item]);
            showCopyStatus(t(`clipboard.${format.toLowerCase()}Copied`));
          };

          try {
            const jpeg = await toBlob(src, "jpeg");
            await tryWrite(jpeg, "jpeg");
            return;
          } catch (errJpeg) {
            console.warn(t("clipboard.jpegFallbackPng"), errJpeg);
            const png = await toBlob(src, "png");
            await tryWrite(png, "png");
            return;
          }
        }
      } catch (err) {
        console.warn(t("clipboard.imageFallbackText"), err);
      }
      try {
        await navigator.clipboard.writeText(src);
        showCopyStatus(
          supportsImageClipboard
            ? t("clipboard.linkCopiedBlocked")
            : t("clipboard.linkCopiedUnsupported")
        );
      } catch {
        showCopyStatus(t("clipboard.copyNotPossible"));
      }
    },
    [showCopyStatus, t]
  );

  const copyPlainUrl = useCallback(
    async (src) => {
      try {
        await navigator.clipboard.writeText(src);
        showCopyStatus(t("clipboard.dataUrlCopied"));
      } catch (err) {
        console.warn("Plain copy failed", err);
        showCopyStatus(t("clipboard.copyNotPossible"));
      }
    },
    [showCopyStatus, t]
  );

  const copyEncrypted = useCallback(
    async (src) => {
      if (!sessionKey) {
        showCopyStatus(t("clipboard.noKeyEncrypted"));
        return;
      }
      try {
        const payload = await encryptDataUrl(src, sessionKey);
        await navigator.clipboard.writeText(JSON.stringify(payload));
        showCopyStatus(t("clipboard.encryptedCopied"));
      } catch (err) {
        console.warn("Encrypted copy failed", err);
        showCopyStatus(t("clipboard.encryptedCopyFailed"));
      }
    },
    [sessionKey, showCopyStatus, t]
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
        if (!blob) throw new Error(t("clipboard.noImage"));
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
        console.warn(t("clipboard.saveFailed"), err);
        showCopyStatus(t("clipboard.saveNotPossible"));
      }
    },
    [showCopyStatus, t]
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
        showCopyStatus(t("clipboard.notSupported"));
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
        showCopyStatus(t("clipboard.loaded"), 1200);
        return;
      }

      showCopyStatus(t("clipboard.noImageData"));
    } catch (err) {
      console.warn("Clipboard read failed", err);
      showCopyStatus(t("clipboard.notReadable"));
    }
  }, [fileToDataUrl, setLightboxSrc, showCopyStatus, t]);

  const handleDesktopClipboardSend = useCallback(async () => {
    if (!clipboardPreview) return;
    try {
      await sendPhotoSecure(clipboardPreview.data);
      showCopyStatus(t("clipboard.imageSent"), 1200);
      setClipboardPreview(null);
      setClipboardMode(false);
      setLightboxSrc?.(null);
    } catch (err) {
      console.warn("Clipboard send failed", err);
      showCopyStatus(t("clipboard.sendFailed"));
    }
  }, [clipboardPreview, sendPhotoSecure, setLightboxSrc, showCopyStatus, t]);

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
