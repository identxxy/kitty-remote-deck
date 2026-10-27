// Width bounds for the resizable sidebar and Browser drawer, as pure functions
// of the viewport so they can be unit-tested without a DOM.
(function attachResizeUtils(global) {
  function sidebarWidthBounds(viewportWidth, range) {
    if (viewportWidth <= 720) {
      return { min: 160, max: Math.max(160, Math.floor(viewportWidth * 0.42)) };
    }
    if (viewportWidth <= 980) {
      return { min: range.min, max: Math.max(range.min, Math.floor(viewportWidth * 0.36)) };
    }
    return { min: range.min, max: range.max };
  }

  // The drawer may take up to range.maxFraction of the viewport on desktop,
  // and never more than what leaves the terminal its minimum width.
  function browserWidthBounds({ viewportWidth, activityWidth, sidebarWidth, range }) {
    const phone = viewportWidth <= 720;
    const minEditorWidth = phone ? 96 : 180;
    const maxByLayout = viewportWidth - activityWidth - (phone ? 0 : sidebarWidth) - minEditorWidth;

    if (phone) {
      const min = Math.min(260, Math.max(220, maxByLayout));
      return { min, max: Math.max(min, maxByLayout) };
    }

    const min = Math.min(range.min, Math.max(260, maxByLayout));
    const maxByFraction = Math.round(viewportWidth * range.maxFraction);
    const max = Math.max(min, Math.min(maxByFraction, maxByLayout));
    return { min, max };
  }

  const api = { sidebarWidthBounds, browserWidthBounds };
  global.KRDResizeUtils = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
