/**
 * Format bytes to human readable string
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string (e.g., "1.5 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Get emoji icon for file type based on extension
 * @param {string} fileName - File name with extension
 * @returns {string} Emoji icon representing the file type
 */
export function getFileIcon(fileName) {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  // Document icons
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["txt", "md"].includes(ext)) return "📃";

  // Archive icons
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "📦";

  // Media icons
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext)) return "🖼️";
  if (["mp4", "avi", "mov", "mkv", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return "🎵";

  // Code icons
  if (["js", "jsx", "ts", "tsx", "json"].includes(ext)) return "💻";
  if (["html", "css", "scss"].includes(ext)) return "🌐";
  if (["py", "java", "cpp", "c", "cs"].includes(ext)) return "⚙️";

  // Default
  return "📁";
}
