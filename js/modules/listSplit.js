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

    if (blockClone.classList.contains('page-break-before')) {
        // Detached measure hosts are outside `#editor`, so mirror the
        // page-break padding/border that affect real block height.
        blockClone.style.borderTop = '2px dashed transparent';
        blockClone.style.paddingTop = '18px';
        blockClone.style.position = 'relative';
    }

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

let listItemSplitGroupCounter = 0;

function nextListItemSplitGroupId() {
    listItemSplitGroupCounter += 1;
    return `list-item-split-${listItemSplitGroupCounter}`;
}

function getTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
        nodes.push(currentNode);
        currentNode = walker.nextNode();
    }
    return nodes;
}

function getConcatenatedText(root) {
    return getTextNodes(root)
        .map((node) => node.nodeValue || '')
        .join('');
}

function totalTextLength(root) {
    return getTextNodes(root).reduce((sum, node) => sum + (node.nodeValue ? node.nodeValue.length : 0), 0);
}

function clampToWordBoundaryLeft(text, index) {
    if (index <= 0) return 0;
    if (index >= text.length) return text.length;

    let i = index;
    while (i > 0 && !/\s/.test(text[i - 1])) i -= 1;
    while (i > 0 && /\s/.test(text[i - 1])) i -= 1;
    return i;
}

function trimCloneToCharCount(blockClone, charCount) {
    if (charCount <= 0) {
        blockClone.replaceChildren(document.createElement('br'));
        return;
    }

    const textNodes = getTextNodes(blockClone);
    let remaining = charCount;

    for (let i = 0; i < textNodes.length; i += 1) {
        const node = textNodes[i];
        const value = node.nodeValue || '';

        if (remaining >= value.length) {
            remaining -= value.length;
            continue;
        }

        node.nodeValue = value.slice(0, remaining);
        remaining = 0;

        for (let j = i + 1; j < textNodes.length; j += 1) {
            const toRemove = textNodes[j];
            if (toRemove.parentNode) {
                toRemove.parentNode.removeChild(toRemove);
            }
        }

        break;
    }
}

function extractFromCharOffset(blockElement, charOffset) {
    const textNodes = getTextNodes(blockElement);
    let offset = charOffset;
    let startNode = null;
    let startOffset = 0;

    for (const node of textNodes) {
        const len = node.nodeValue ? node.nodeValue.length : 0;
        if (offset <= len) {
            startNode = node;
            startOffset = offset;
            break;
        }
        offset -= len;
    }

    if (!startNode) {
        return null;
    }

    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(blockElement, blockElement.childNodes.length);
    return range.extractContents();
}

function isSplittableListItemContent(listItemElement) {
    if (!(listItemElement instanceof HTMLLIElement)) {
        return false;
    }

    return !listItemElement.querySelector('img, table, ul, ol');
}

function splitListItemToFit(editorElement, listItemElement, maxHeightPx) {
    if (maxHeightPx <= 0 || !isSplittableListItemContent(listItemElement)) {
        return null;
    }

    const fullLen = totalTextLength(listItemElement);
    const text = getConcatenatedText(listItemElement);
    const originalHtml = listItemElement.innerHTML;

    if (fullLen <= 1) {
        return null;
    }

    const probeClone = listItemElement.cloneNode(true);
    trimCloneToCharCount(probeClone, 1);
    if (measureHeightForClone(editorElement, probeClone) > maxHeightPx) {
        return null;
    }

    let low = 1;
    let high = fullLen;
    let best = 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const clone = listItemElement.cloneNode(true);
        trimCloneToCharCount(clone, mid);
        const h = measureHeightForClone(editorElement, clone);
        if (h <= maxHeightPx) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    const bestWord = clampToWordBoundaryLeft(text, Math.min(best, text.length));
    const safeBest = Math.max(1, Math.min(bestWord, fullLen - 1));

    if (safeBest >= fullLen) {
        return null;
    }

    const remainderFragment = extractFromCharOffset(listItemElement, safeBest);
    if (!remainderFragment) {
        return null;
    }

    const remainderItem = listItemElement.cloneNode(false);
    remainderItem.appendChild(remainderFragment);

    const currentText = listItemElement.textContent ? listItemElement.textContent.trim() : '';
    const remainderText = remainderItem.textContent ? remainderItem.textContent.trim() : '';

    if (!currentText || !remainderText) {
        listItemElement.innerHTML = originalHtml;
        return null;
    }

    const groupId = nextListItemSplitGroupId();
    listItemElement.dataset.paginationSplitType = 'list-item';
    listItemElement.dataset.paginationSplitGroup = groupId;
    remainderItem.dataset.paginationSplitType = 'list-item';
    remainderItem.dataset.paginationSplitGroup = groupId;
    remainderItem.dataset.paginationSplitContinuation = 'true';
    remainderItem.style.listStyleType = 'none';

    return remainderItem;
}

function splitListBlockToFit(editorElement, blockElement, maxHeightPx) {
    if (maxHeightPx <= 0) return null;

    const listElement = blockElement.querySelector('ul, ol');
    if (!listElement || !isPureListBlock(blockElement, listElement)) {
        return null;
    }

    const items = getDirectListItems(listElement);
    if (items.length === 0) return null;

    let low = 0;
    let high = items.length;
    let best = 0;

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

    const targetItemIndex = best;
    const targetItem = items[targetItemIndex] || null;
    const keptBlockClone = blockElement.cloneNode(true);
    trimListCloneToItemCount(keptBlockClone, best);
    const keptBlockHeight = measureHeightForClone(editorElement, keptBlockClone);
    const remainingHeightForSplitItem = Math.max(0, maxHeightPx - keptBlockHeight);

    if (targetItem && remainingHeightForSplitItem > 0) {
        const remainderItem = splitListItemToFit(editorElement, targetItem, remainingHeightForSplitItem);
        if (remainderItem) {
            const remainderBlock = blockElement.cloneNode(true);
            trimListCloneToItemCount(blockElement, best + 1);
            removeFirstNListItems(remainderBlock, best);

            const remainderList = remainderBlock.querySelector('ul, ol');
            const remainderItems = remainderList ? getDirectListItems(remainderList) : [];
            if (remainderItems.length > 0) {
                remainderItems[0].replaceWith(remainderItem);
            }

            return remainderBlock;
        }
    }

    if (best === 0) {
        return null;
    }

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
    getDirectListItems,
    splitListBlockToFit
};

