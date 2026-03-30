function ensureMeasureHost(editorElement) {
    let host = document.getElementById('__pageBreakMeasureHostList');
    if (host) return host;

    host = document.createElement('div');
    host.id = '__pageBreakMeasureHostList';
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.style.whiteSpace = 'normal';
    document.body.appendChild(host);

    const editorStyle = window.getComputedStyle(editorElement);
    host.style.font = editorStyle.font;
    host.style.letterSpacing = editorStyle.letterSpacing;
    host.style.wordSpacing = editorStyle.wordSpacing;
    host.style.lineHeight = editorStyle.lineHeight;
    host.style.padding = '0';
    host.style.border = '0';
    host.style.margin = '0';
    host.style.boxSizing = 'content-box';

    return host;
}

function setMeasureWidth(measureHost, editorElement) {
    const style = window.getComputedStyle(editorElement);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const contentWidth = Math.max(0, editorElement.clientWidth - padL - padR);
    measureHost.style.width = `${contentWidth}px`;
}

function measureHeightForClone(editorElement, blockClone) {
    const host = ensureMeasureHost(editorElement);
    setMeasureWidth(host, editorElement);
    host.replaceChildren(blockClone);
    return Math.ceil(blockClone.getBoundingClientRect().height);
}

function getDirectListItems(listElement) {
    try {
        // Prefer direct children, preserving nested lists inside each LI.
        return Array.from(listElement.querySelectorAll(':scope > li'));
    } catch {
        // Fallback if :scope is unsupported.
        return Array.from(listElement.children).filter((el) => el.tagName === 'LI');
    }
}

function isPureListBlock(blockElement, listElement) {
    if (!listElement) return false;
    if (listElement.parentElement !== blockElement) return false;

    const nonEmptyTextNodes = Array.from(blockElement.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 0
    );
    const elementChildren = Array.from(blockElement.children).filter(
        (el) => el.tagName !== 'BR'
    );

    return nonEmptyTextNodes.length === 0 && elementChildren.length === 1 && elementChildren[0] === listElement;
}

function trimListCloneToItemCount(blockClone, count) {
    const listClone = blockClone.querySelector('ul, ol');
    if (!listClone) return;
    const items = getDirectListItems(listClone);
    for (let i = items.length - 1; i >= count; i -= 1) {
        items[i].remove();
    }
}

function removeFirstNListItems(blockClone, count) {
    const listClone = blockClone.querySelector('ul, ol');
    if (!listClone) return;
    const items = getDirectListItems(listClone);
    for (let i = 0; i < Math.min(count, items.length); i += 1) {
        items[i].remove();
    }
}

function splitListBlockToFit(editorElement, blockElement, maxHeightPx) {
    if (maxHeightPx <= 0) return null;

    const listElement = blockElement.querySelector('ul, ol');
    if (!listElement || !isPureListBlock(blockElement, listElement)) {
        return null;
    }

    const items = getDirectListItems(listElement);
    if (items.length <= 1) return null;

    const probeClone = blockElement.cloneNode(true);
    trimListCloneToItemCount(probeClone, 1);
    if (measureHeightForClone(editorElement, probeClone) > maxHeightPx) {
        return null;
    }

    let low = 1;
    let high = items.length;
    let best = 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const clone = blockElement.cloneNode(true);
        trimListCloneToItemCount(clone, mid);
        const h = measureHeightForClone(editorElement, clone);
        if (h <= maxHeightPx) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (best >= items.length) return null;

    const remainderBlock = blockElement.cloneNode(true);
    trimListCloneToItemCount(blockElement, best);
    removeFirstNListItems(remainderBlock, best);

    const remainderList = remainderBlock.querySelector('ul, ol');
    if (!remainderList || getDirectListItems(remainderList).length === 0) {
        return null;
    }

    return remainderBlock;
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.listSplit = {
    splitListBlockToFit
};

