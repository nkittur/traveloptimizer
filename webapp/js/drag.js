// drag.js — SortableJS wrapper for shortlist reordering
let _sortable = null;

export function initSortable(container, onReorder) {
  if (_sortable) _sortable.destroy();
  if (!container || !window.Sortable) return;

  _sortable = new Sortable(container, {
    animation: 200,
    handle: '.drag-handle',
    delay: 150,
    delayOnTouchOnly: true,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd(evt) {
      const ids = Array.from(container.children)
        .map(el => el.dataset.id)
        .filter(Boolean);
      onReorder(ids);
    },
  });
}

export function destroySortable() {
  if (_sortable) {
    _sortable.destroy();
    _sortable = null;
  }
}
