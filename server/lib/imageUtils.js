/* =========================
   IMAGE PAYLOAD UTILITIES
========================= */

function normalizeImageDataList(imageData = null) {
  if (Array.isArray(imageData)) {
    return imageData.filter((item) => item?.base64 && item?.mimeType);
  }

  return imageData?.base64 && imageData?.mimeType ? [imageData] : [];
}

function hasImagePayload(imageData = null) {
  return normalizeImageDataList(imageData).length > 0;
}

module.exports = {
  normalizeImageDataList,
  hasImagePayload,
};
