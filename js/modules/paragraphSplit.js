function ensureMeasureHost(editorElement) {
    let host = document.getElementById('__pageBreakMeasureHost');
    if (host) return host;

    host = document.createElement('div');
    host.id = '__pageBreakMeasureHost';
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.style.whiteSpace = 'normal';
    document.body.appendChild(host);

    // Mirror key typography/layout so measurements match the editor.
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
    // Match the editor's *content* width (excluding padding).
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
        // The live editor styles page-break blocks via `#editor .page-break-before`,
        // which does not apply inside the detached measure host.
        blockClone.style.borderTop = '2px dashed transparent';
        blockClone.style.paddingTop = '18px';
        blockClone.style.position = 'relative';
    }

    host.replaceChildren(blockClone);
    return Math.ceil(blockClone.getBoundingClientRect().height);
}

function getTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n = walker.nextNode();
    while (n) {
        nodes.push(n);
        n = walker.nextNode();
    }
    return nodes;
}

function totalTextLength(root) {
    return getTextNodes(root).reduce((sum, n) => sum + (n.nodeValue ? n.nodeValue.length : 0), 0);
}

function getConcatenatedText(root) {
    return getTextNodes(root)
        .map((n) => n.nodeValue || '')
        .join('');
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

        // Cut this node and remove all following content.
        node.nodeValue = value.slice(0, remaining);
        remaining = 0;

        // Remove all nodes that come after this text node.
        for (let j = i + 1; j < textNodes.length; j += 1) {
            const toRemove = textNodes[j];
            if (toRemove.parentNode) toRemove.parentNode.removeChild(toRemove);
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

function splitParagraphBlockToFit(editorElement, blockElement, maxHeightPx) {
    const text = getConcatenatedText(blockElement);
    const fullLen = totalTextLength(blockElement);
    const originalHtml = blockElement.innerHTML;
    if (fullLen <= 1) return null;

    // If even a tiny amount can't fit, signal "can't split meaningfully".
    const probeClone = blockElement.cloneNode(true);
    trimCloneToCharCount(probeClone, 1);
    if (measureHeightForClone(editorElement, probeClone) > maxHeightPx) {
        return null;
    }

    let low = 1;
    let high = fullLen;
    let best = 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const clone = blockElement.cloneNode(true);
        trimCloneToCharCount(clone, mid);
        const h = measureHeightForClone(editorElement, clone);

        if (h <= maxHeightPx) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    // Nudge left to a word boundary to avoid mid-word splits.
    const bestWord = clampToWordBoundaryLeft(text, Math.min(best, text.length));
    const safeBest = Math.max(1, Math.min(bestWord, fullLen - 1));

    if (safeBest >= fullLen) return null;

    const remainderFragment = extractFromCharOffset(blockElement, safeBest);
    if (!remainderFragment) return null;

    const remainderBlock = blockElement.cloneNode(false);
    remainderBlock.appendChild(remainderFragment);

    const currentText = blockElement.textContent ? blockElement.textContent.trim() : '';
    const remainderText = remainderBlock.textContent ? remainderBlock.textContent.trim() : '';

    // Reject splits that only preserve formatting whitespace on either side.
    // In those cases the whole paragraph should move to the next page instead.
    if (!currentText || !remainderText) {
        blockElement.innerHTML = originalHtml;
        return null;
    }

    return remainderBlock;
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.paragraphSplit = {
    splitParagraphBlockToFit
};
