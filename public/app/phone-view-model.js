// Phone presentation is independent of account permissions and shared board data.
// Tablets retain the editor, including when their window is narrow.
function isPhoneViewer() {
  return document.documentElement.dataset.formFactor === 'phone';
}

function canRenderPhoneItem(item) {
  const formFactor = document.documentElement.dataset.formFactor;
  if ((formFactor === 'phone' || formFactor === 'tablet') && window.__independentNotesActive) return false;
  return !isPhoneViewer() || !item.type?.startsWith('amap-');
}

export { isPhoneViewer, canRenderPhoneItem };
