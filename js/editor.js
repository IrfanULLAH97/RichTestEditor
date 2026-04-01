const minPageHeight = 100;
const realtimeRepaginationDelayMs = 150;
let activePageHeight = null;
let repaginationTimerId = null;
let isPaginating = false;
let selectionMarkerCounter = 0;

function formatText(command) {
    document.execCommand(command, false, null);
    scheduleRealtimePagination();
}

function insertTable() {
    const table = `
        <table border="1" style="width: 100%; margin: 10px 0;">
            <tr>
                <td>Cell 1</td>
                <td>Cell 2</td>
            </tr>
            <tr>
                <td>Cell 3</td>
                <td>Cell 4</td>
            </tr>
        </table>
    `;
    document.execCommand('insertHTML', false, table);
    scheduleRealtimePagination();
}

function insertList(type) {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);

    const list = document.createElement(type);
    const listItem = document.createElement('li');
    listItem.textContent = 'List item';
    list.appendChild(listItem);

    range.deleteContents();
    range.insertNode(list);

    const newItem = document.createElement('li');
    newItem.appendChild(document.createElement('br'));
    list.appendChild(newItem);

    const newRange = document.createRange();
    newRange.setStart(newItem, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    scheduleRealtimePagination();
}

function insertImage() {
    const imageUrl = prompt('Please enter the image URL:');
    if (imageUrl) {
        const img = `<img src="${imageUrl}" alt="Inserted image" style="max-width: 100%; height: auto;">`;
        document.execCommand('insertHTML', false, img);
        bindImageLoadListeners(editor);
        scheduleRealtimePagination();
    }
}

function getConfiguredPageHeight(showAlertOnInvalid) {
    const pageHeight = parseInt(document.getElementById('pageHeight').value, 10);
    if (Number.isNaN(pageHeight) || pageHeight < minPageHeight) {
        if (showAlertOnInvalid) {
            alert(`For meaningful and clear results, please keep the page height at ${minPageHeight}px or more.`);
        }
        return null;
    }

    return pageHeight;
}

function logPaginationDetails(editorElement, pageSummaries) {
    const typedBlocks = window.EditorModules.blockTypes.getEditorBlocksWithTypes(editorElement);
    console.table(
        typedBlocks.map((block) => ({
            index: block.index,
            type: block.type,
            page: Number(block.element.dataset.pageIndex),
            height: Math.round(block.element.getBoundingClientRect().height)
        }))
    );

    console.table(pageSummaries);
}

function nextSelectionMarkerId(prefix) {
    selectionMarkerCounter += 1;
    return `${prefix}-${selectionMarkerCounter}`;
}

function saveSelectionMarkers(editorElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.startContainer) || !editorElement.contains(range.endContainer)) {
        return null;
    }

    const markerState = {
        collapsed: range.collapsed,
        startId: nextSelectionMarkerId('pagination-selection-start'),
        endId: null
    };

    if (!range.collapsed) {
        markerState.endId = nextSelectionMarkerId('pagination-selection-end');
        const endMarker = document.createComment(markerState.endId);
        const endRange = range.cloneRange();
        endRange.collapse(false);
        endRange.insertNode(endMarker);
    }

    const startMarker = document.createComment(markerState.startId);
    const startRange = range.cloneRange();
    startRange.collapse(true);
    startRange.insertNode(startMarker);

    return markerState;
}

function findSelectionMarker(editorElement, markerId) {
    if (!markerId) return null;

    const walker = document.createTreeWalker(editorElement, NodeFilter.SHOW_COMMENT);
    let currentNode = walker.nextNode();
    while (currentNode) {
        if (currentNode.nodeValue === markerId) {
            return currentNode;
        }
        currentNode = walker.nextNode();
    }

    return null;
}

function restoreSelectionFromMarkers(editorElement, markerState) {
    if (!markerState) return;

    const selection = window.getSelection();
    if (!selection) return;

    const startMarker = findSelectionMarker(editorElement, markerState.startId);
    const endMarker = markerState.collapsed ? null : findSelectionMarker(editorElement, markerState.endId);

    if (!startMarker) {
        if (endMarker && endMarker.parentNode) {
            endMarker.parentNode.removeChild(endMarker);
        }
        return;
    }

    const range = document.createRange();
    range.setStartBefore(startMarker);

    if (markerState.collapsed || !endMarker) {
        range.collapse(true);
    } else {
        range.setEndBefore(endMarker);
    }

    editorElement.focus();
    selection.removeAllRanges();
    selection.addRange(range);

    if (startMarker.parentNode) {
        startMarker.parentNode.removeChild(startMarker);
    }
    if (endMarker && endMarker.parentNode) {
        endMarker.parentNode.removeChild(endMarker);
    }
}

function bindImageLoadListeners(editorElement) {
    const images = editorElement.querySelectorAll('img');
    images.forEach((image) => {
        if (image.dataset.paginationLoadBound === 'true') return;
        image.dataset.paginationLoadBound = 'true';
        image.addEventListener('load', scheduleRealtimePagination);
    });
}

function applyPageBreaksForEditor(options) {
    const {
        pageHeight,
        showAlert = false,
        logToConsole = false,
        preserveSelection = false
    } = options || {};

    const editorElement = document.getElementById('editor');
    const resolvedPageHeight = pageHeight ?? activePageHeight;
    if (resolvedPageHeight === null || resolvedPageHeight === undefined || isPaginating) {
        return null;
    }

    if (repaginationTimerId !== null) {
        window.clearTimeout(repaginationTimerId);
        repaginationTimerId = null;
    }

    const selectionMarkers = preserveSelection ? saveSelectionMarkers(editorElement) : null;

    isPaginating = true;
    try {
        const result = window.EditorModules.pagination.applyPageBreaks(editorElement, resolvedPageHeight);
        bindImageLoadListeners(editorElement);

        if (selectionMarkers) {
            restoreSelectionFromMarkers(editorElement, selectionMarkers);
        }

        if (logToConsole) {
            logPaginationDetails(editorElement, result.pageSummaries);
        }

        if (showAlert) {
            alert(`Page breaks applied. Total pages: ${result.totalPages}`);
        }

        return result;
    } finally {
        isPaginating = false;
    }
}

function scheduleRealtimePagination() {
    if (activePageHeight === null || isPaginating) return;

    if (repaginationTimerId !== null) {
        window.clearTimeout(repaginationTimerId);
    }

    repaginationTimerId = window.setTimeout(() => {
        repaginationTimerId = null;
        applyPageBreaksForEditor({
            pageHeight: activePageHeight,
            preserveSelection: true
        });
    }, realtimeRepaginationDelayMs);
}

function setPageBreak() {
    const pageHeight = getConfiguredPageHeight(true);
    if (pageHeight === null) {
        return;
    }

    activePageHeight = pageHeight;
    applyPageBreaksForEditor({
        pageHeight,
        showAlert: true,
        logToConsole: true
    });
}

// Expose toolbar handlers used by inline onclick attributes.
window.formatText = formatText;
window.insertTable = insertTable;
window.insertList = insertList;
window.insertImage = insertImage;
window.setPageBreak = setPageBreak;

const editor = document.getElementById('editor');
bindImageLoadListeners(editor);

editor.addEventListener(
    'focus',
    function () {
        if (editor.textContent === 'Start typing here...') {
            editor.textContent = '';
        }
    },
    { once: true }
);

editor.addEventListener('input', function () {
    bindImageLoadListeners(editor);
    scheduleRealtimePagination();
});

