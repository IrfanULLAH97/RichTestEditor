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
            const endParent = endMarker.parentNode;
            endParent.removeChild(endMarker);
            endParent.normalize();
        }
        return;
    }

    const startPosition = resolveCaretPositionFromMarker(startMarker, 'forward');
    const endPosition = markerState.collapsed || !endMarker
        ? null
        : resolveCaretPositionFromMarker(endMarker, 'backward');

    if (!startPosition) {
        if (startMarker.parentNode) {
            const startParent = startMarker.parentNode;
            startParent.removeChild(startMarker);
            startParent.normalize();
        }
        if (endMarker && endMarker.parentNode) {
            const endParent = endMarker.parentNode;
            endParent.removeChild(endMarker);
            endParent.normalize();
        }
        return;
    }

    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);

    if (markerState.collapsed || !endMarker || !endPosition) {
        range.collapse(true);
    } else {
        range.setEnd(endPosition.node, endPosition.offset);
    }

    editorElement.focus();
    selection.removeAllRanges();
    selection.addRange(range);

    if (startMarker.parentNode) {
        const startParent = startMarker.parentNode;
        startParent.removeChild(startMarker);
        startParent.normalize();
    }
    if (endMarker && endMarker.parentNode) {
        const endParent = endMarker.parentNode;
        endParent.removeChild(endMarker);
        endParent.normalize();
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

function getTopLevelEditorBlock(editorElement, node) {
    let currentNode = node;

    while (currentNode && currentNode !== editorElement) {
        if (currentNode.parentNode === editorElement && currentNode.nodeType === Node.ELEMENT_NODE) {
            return currentNode;
        }
        currentNode = currentNode.parentNode;
    }

    return null;
}

function getPreviousEditorBlock(block) {
    let previousBlock = block ? block.previousElementSibling : null;

    while (
        previousBlock &&
        window.EditorModules.blockTypes.isPaginationInternalElement(previousBlock)
    ) {
        previousBlock = previousBlock.previousElementSibling;
    }

    return previousBlock;
}

function getNextEditorBlock(block) {
    let nextBlock = block ? block.nextElementSibling : null;

    while (
        nextBlock &&
        window.EditorModules.blockTypes.isPaginationInternalElement(nextBlock)
    ) {
        nextBlock = nextBlock.nextElementSibling;
    }

    return nextBlock;
}

function resetPaginationMetadata(block) {
    if (!(block instanceof HTMLElement)) return;

    block.classList.remove('page-break-before');
    delete block.dataset.pageIndex;
    delete block.dataset.paginationSplitType;
    delete block.dataset.paginationSplitGroup;
    delete block.dataset.paginationBoundarySpaceBefore;
    delete block.dataset.paginationBoundaryEdited;
}

function isCaretAtStartOfBlock(block, range) {
    if (!block || !range || !range.collapsed) return false;
    if (!(block.contains(range.startContainer) || block === range.startContainer)) {
        return false;
    }

    if (block instanceof HTMLBRElement) {
        return false;
    }

    const blockStartRange = range.cloneRange();
    blockStartRange.setStart(block, 0);
    const prefixText = blockStartRange.toString();
    if (prefixText.length === 0) {
        return true;
    }

    if (prefixText.trim().length > 0) {
        return false;
    }

    const fullText = block.textContent || '';
    const leadingWhitespaceMatch = fullText.match(/^\s*/);
    const leadingWhitespaceLength = leadingWhitespaceMatch ? leadingWhitespaceMatch[0].length : 0;
    return prefixText.length === leadingWhitespaceLength;
}

function isCaretAtEndOfBlock(block, range) {
    if (!block || !range || !range.collapsed) return false;
    if (!(block.contains(range.startContainer) || block === range.startContainer)) {
        return false;
    }

    if (block instanceof HTMLBRElement) {
        return false;
    }

    const blockEndRange = range.cloneRange();
    blockEndRange.setEnd(block, block.childNodes.length);
    const suffixText = blockEndRange.toString();
    if (suffixText.length === 0) {
        return true;
    }

    if (suffixText.trim().length > 0) {
        return false;
    }

    const fullText = block.textContent || '';
    const trailingWhitespaceMatch = fullText.match(/\s*$/);
    const trailingWhitespaceLength = trailingWhitespaceMatch ? trailingWhitespaceMatch[0].length : 0;
    return suffixText.length === trailingWhitespaceLength;
}

function insertCommentMarkerAtBlockStart(block, prefix) {
    const marker = document.createComment(nextSelectionMarkerId(prefix));

    if (block instanceof HTMLBRElement) {
        block.parentNode.insertBefore(marker, block);
        return marker;
    }

    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(true);
    range.insertNode(marker);
    return marker;
}

function insertCommentMarkerAtBlockEnd(block, prefix) {
    const marker = document.createComment(nextSelectionMarkerId(prefix));

    if (block instanceof HTMLBRElement) {
        block.parentNode.insertBefore(marker, block.nextSibling);
        return marker;
    }

    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    range.insertNode(marker);
    return marker;
}

function ensureBlockHasEditablePosition(block) {
    if (!(block instanceof HTMLElement)) return;

    const hasVisibleText = block.textContent && block.textContent.trim().length > 0;
    if (hasVisibleText || block.querySelector('br, img, table, ul, ol')) {
        return;
    }

    block.innerHTML = '<br>';
}

function createParagraphBlockClone(block) {
    const clone = block.cloneNode(false);
    resetPaginationMetadata(clone);
    return clone;
}

function getTrailingTextCharacter(block) {
    if (!(block instanceof HTMLElement)) {
        return '';
    }

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
        textNodes.push(currentNode);
        currentNode = walker.nextNode();
    }

    for (let i = textNodes.length - 1; i >= 0; i -= 1) {
        const value = textNodes[i].nodeValue || '';
        if (value.length > 0) {
            return value[value.length - 1];
        }
    }

    return '';
}

function getLeadingTextCharacter(block) {
    if (!(block instanceof HTMLElement)) {
        return '';
    }

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
        const value = currentNode.nodeValue || '';
        if (value.length > 0) {
            return value[0];
        }
        currentNode = walker.nextNode();
    }

    return '';
}

function appendBlockContentsWithBoundarySpace(targetBlock, sourceBlock) {
    if (!(targetBlock instanceof HTMLElement) || !(sourceBlock instanceof HTMLElement)) {
        return;
    }

    const trailingCharacter = getTrailingTextCharacter(targetBlock);
    const leadingCharacter = getLeadingTextCharacter(sourceBlock);
    const shouldInsertBoundarySpace =
        trailingCharacter &&
        leadingCharacter &&
        !/\s/.test(trailingCharacter) &&
        !/\s/.test(leadingCharacter);

    if (shouldInsertBoundarySpace) {
        targetBlock.appendChild(document.createTextNode(' '));
    }

    while (sourceBlock.firstChild) {
        targetBlock.appendChild(sourceBlock.firstChild);
    }
}

function moveTrailingWhitespaceToBlockStart(sourceBlock, targetBlock) {
    if (!(sourceBlock instanceof HTMLElement) || !(targetBlock instanceof HTMLElement)) {
        return;
    }

    const sourceWalker = document.createTreeWalker(sourceBlock, NodeFilter.SHOW_TEXT);
    const sourceTextNodes = [];
    let sourceNode = sourceWalker.nextNode();
    while (sourceNode) {
        sourceTextNodes.push(sourceNode);
        sourceNode = sourceWalker.nextNode();
    }

    for (let i = sourceTextNodes.length - 1; i >= 0; i -= 1) {
        const value = sourceTextNodes[i].nodeValue || '';
        const trailingWhitespaceMatch = value.match(/(\s+)$/);
        if (!trailingWhitespaceMatch) {
            if (value.length > 0) {
                return;
            }
            continue;
        }

        const whitespace = trailingWhitespaceMatch[1];
        sourceTextNodes[i].nodeValue = value.slice(0, value.length - whitespace.length);
        if (sourceTextNodes[i].nodeValue.length === 0) {
            sourceTextNodes[i].remove();
        }

        if (targetBlock.firstChild?.nodeType === Node.TEXT_NODE) {
            targetBlock.firstChild.nodeValue = whitespace + (targetBlock.firstChild.nodeValue || '');
        } else {
            targetBlock.insertBefore(document.createTextNode(whitespace), targetBlock.firstChild);
        }
        return;
    }
}

function absorbFollowingParagraphSplitBlocks(splitReferenceBlock, startAfterBlock, targetBlock) {
    if (
        !(splitReferenceBlock instanceof HTMLElement) ||
        !(startAfterBlock instanceof HTMLElement) ||
        !(targetBlock instanceof HTMLElement)
    ) {
        return;
    }

    if (splitReferenceBlock.dataset.paginationSplitType !== 'paragraph') {
        return;
    }

    let nextBlock = getNextEditorBlock(startAfterBlock);
    while (nextBlock instanceof HTMLElement && areBlocksFromSameParagraphSplit(splitReferenceBlock, nextBlock)) {
        const blockToAbsorb = nextBlock;
        nextBlock = getNextEditorBlock(blockToAbsorb);
        appendBlockContentsWithBoundarySpace(targetBlock, blockToAbsorb);
        blockToAbsorb.remove();
    }

    ensureBlockHasEditablePosition(targetBlock);
}

function getNodeOffsetWithinParent(node) {
    if (!node || !node.parentNode) return -1;
    return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
}

function resolveForwardCaretPositionFromNode(node) {
    if (!node) return null;

    if (node.nodeType === Node.TEXT_NODE) {
        return {
            node,
            offset: 0
        };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }

    if (node instanceof HTMLBRElement) {
        const offset = getNodeOffsetWithinParent(node);
        if (offset === -1) return null;
        return {
            node: node.parentNode,
            offset
        };
    }

    for (const child of node.childNodes) {
        const position = resolveForwardCaretPositionFromNode(child);
        if (position) {
            return position;
        }
    }

    const offset = getNodeOffsetWithinParent(node);
    if (offset === -1) return null;

    return {
        node: node.parentNode,
        offset
    };
}

function resolveCaretPositionFromMarker(marker, direction) {
    if (!marker || !marker.parentNode) return null;

    if (direction === 'forward') {
        let nextNode = marker.nextSibling;
        while (nextNode) {
            const position = resolveForwardCaretPositionFromNode(nextNode);
            if (position) {
                return position;
            }
            nextNode = nextNode.nextSibling;
        }

        const offset = getNodeOffsetWithinParent(marker);
        if (offset === -1) return null;
        return {
            node: marker.parentNode,
            offset
        };
    }

    const offset = getNodeOffsetWithinParent(marker);
    if (offset === -1) return null;
    return {
        node: marker.parentNode,
        offset
    };
}

function moveCaretToMarker(editorElement, marker, direction = 'backward') {
    if (!marker) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    const position = resolveCaretPositionFromMarker(marker, direction);
    if (!position) {
        if (marker.parentNode) {
            const markerParent = marker.parentNode;
            markerParent.removeChild(marker);
            markerParent.normalize();
        }
        return false;
    }

    const range = document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);

    editorElement.focus();
    selection.removeAllRanges();
    selection.addRange(range);

    if (marker.parentNode) {
        const markerParent = marker.parentNode;
        markerParent.removeChild(marker);
        markerParent.normalize();
    }

    return true;
}

function getSingleDirectListElement(block) {
    if (!(block instanceof HTMLElement)) return null;

    const nonBrChildren = Array.from(block.children).filter((child) => child.tagName !== 'BR');
    if (nonBrChildren.length !== 1) return null;

    const onlyChild = nonBrChildren[0];
    if (onlyChild.tagName !== 'UL' && onlyChild.tagName !== 'OL') return null;

    const hasNonEmptyTextNode = Array.from(block.childNodes).some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length > 0
    );
    if (hasNonEmptyTextNode) return null;

    return onlyChild;
}

function getDirectListItems(listElement) {
    if (!(listElement instanceof HTMLElement)) return [];

    try {
        return Array.from(listElement.querySelectorAll(':scope > li'));
    } catch {
        return Array.from(listElement.children).filter((child) => child.tagName === 'LI');
    }
}

function getFirstDirectListItemFromBlock(block) {
    const listElement = getSingleDirectListElement(block);
    if (!listElement) return null;

    const items = getDirectListItems(listElement);
    return items.length > 0 ? items[0] : null;
}

function getLastDirectListItemFromBlock(block) {
    const listElement = getSingleDirectListElement(block);
    if (!listElement) return null;

    const items = getDirectListItems(listElement);
    return items.length > 0 ? items[items.length - 1] : null;
}

function isEffectivelyEmptyListItem(listItem) {
    if (!(listItem instanceof HTMLLIElement)) return false;

    const text = listItem.textContent ? listItem.textContent.replace(/\u00a0/g, ' ').trim() : '';
    if (text.length > 0) {
        return false;
    }

    return !listItem.querySelector('img, table, ul, ol');
}

function canMergeListBlocks(previousBlock, currentBlock) {
    const previousList = getSingleDirectListElement(previousBlock);
    const currentList = getSingleDirectListElement(currentBlock);

    if (!previousList || !currentList) return false;
    if (previousList.tagName !== currentList.tagName) return false;
    if (previousList.className !== currentList.className) return false;
    if ((previousList.getAttribute('style') || '') !== (currentList.getAttribute('style') || '')) return false;

    return true;
}

function areBlocksFromSameParagraphSplit(previousBlock, currentBlock) {
    if (!(previousBlock instanceof HTMLElement) || !(currentBlock instanceof HTMLElement)) {
        return false;
    }

    return (
        previousBlock.dataset.paginationSplitType === 'paragraph' &&
        currentBlock.dataset.paginationSplitType === 'paragraph' &&
        previousBlock.dataset.paginationSplitGroup &&
        previousBlock.dataset.paginationSplitGroup === currentBlock.dataset.paginationSplitGroup
    );
}

function trimLeadingWhitespaceFromBlock(block) {
    if (!(block instanceof HTMLElement)) return;

    let currentNode = block.firstChild;
    while (currentNode) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
            const value = currentNode.nodeValue || '';
            if (value.length === 0) {
                const nextNode = currentNode.nextSibling;
                currentNode.remove();
                currentNode = nextNode;
                continue;
            }

            const trimmed = value.replace(/^\s+/, '');
            if (trimmed.length !== value.length) {
                if (trimmed.length === 0) {
                    const nextNode = currentNode.nextSibling;
                    currentNode.remove();
                    currentNode = nextNode;
                    continue;
                }

                currentNode.nodeValue = trimmed;
            }
            return;
        }

        if (currentNode.nodeType === Node.ELEMENT_NODE) {
            return;
        }

        currentNode = currentNode.nextSibling;
    }
}

function getLeadingWhitespaceLength(block) {
    if (!(block instanceof HTMLElement)) return 0;

    const text = block.textContent || '';
    const match = text.match(/^\s*/);
    return match ? match[0].length : 0;
}

function setCaretAtTextOffsetInBlock(editorElement, block, textOffset) {
    if (!(block instanceof HTMLElement)) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    let remaining = Math.max(0, textOffset);

    while (currentNode) {
        const value = currentNode.nodeValue || '';
        if (remaining <= value.length) {
            const range = document.createRange();
            range.setStart(currentNode, remaining);
            range.collapse(true);
            editorElement.focus();
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        }

        remaining -= value.length;
        currentNode = walker.nextNode();
    }

    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    editorElement.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function setCaretAtEndOfBlock(editorElement, block) {
    if (!(block instanceof HTMLElement)) return false;

    const selection = window.getSelection();
    if (!selection) return false;

    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(false);
    editorElement.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

function getCaretLeadingWhitespaceOffset(block, range) {
    if (!(block instanceof HTMLElement) || !range || !range.collapsed) {
        return null;
    }

    if (!(block.contains(range.startContainer) || block === range.startContainer)) {
        return null;
    }

    const prefixRange = range.cloneRange();
    prefixRange.setStart(block, 0);
    const prefixText = prefixRange.toString();
    if (prefixText.length === 0) {
        return 0;
    }

    if (prefixText.trim().length > 0) {
        return null;
    }

    const leadingWhitespaceLength = getLeadingWhitespaceLength(block);
    if (prefixText.length > leadingWhitespaceLength) {
        return null;
    }

    return prefixText.length;
}

function removeLeadingWhitespaceFromBlockAtOffset(editorElement, block, whitespaceOffset) {
    if (!(block instanceof HTMLElement)) return false;
    if (!Number.isFinite(whitespaceOffset) || whitespaceOffset <= 0) return false;

    let currentNode = block.firstChild;
    let traversedWhitespace = 0;

    while (currentNode) {
        if (currentNode.nodeType === Node.TEXT_NODE) {
            const value = currentNode.nodeValue || '';
            if (value.length === 0) {
                const nextNode = currentNode.nextSibling;
                currentNode.remove();
                currentNode = nextNode;
                continue;
            }

            const leadingWhitespaceMatch = value.match(/^\s+/);
            if (!leadingWhitespaceMatch) {
                const nextNode = currentNode.nextSibling;
                currentNode = nextNode;
                continue;
            }

            const nodeLeadingWhitespaceLength = leadingWhitespaceMatch[0].length;
            if (traversedWhitespace + nodeLeadingWhitespaceLength < whitespaceOffset) {
                traversedWhitespace += nodeLeadingWhitespaceLength;
                const nextNode = currentNode.nextSibling;
                currentNode = nextNode;
                continue;
            }

            const offsetWithinNode = whitespaceOffset - traversedWhitespace - 1;
            currentNode.nodeValue = value.slice(0, offsetWithinNode) + value.slice(offsetWithinNode + 1);
            if ((currentNode.nodeValue || '').length === 0) {
                const nextNode = currentNode.nextSibling;
                currentNode.remove();
                currentNode = nextNode;
            }

            setCaretAtTextOffsetInBlock(editorElement, block, whitespaceOffset - 1);
            return true;
        }

        if (currentNode.nodeType === Node.ELEMENT_NODE) {
            return false;
        }

        currentNode = currentNode.nextSibling;
    }

    return false;
}

function removeOneLeadingWhitespaceFromBlock(editorElement, block) {
    return removeLeadingWhitespaceFromBlockAtOffset(editorElement, block, 1);
}

function markBoundarySpaceRemoved(block) {
    if (!(block instanceof HTMLElement)) return;
    block.dataset.paginationBoundarySpaceBefore = 'false';
    block.dataset.paginationBoundaryEdited = 'true';
}

function markSelectionParagraphBoundaryEdited(editorElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return;
    }

    const currentBlock = getTopLevelEditorBlock(editorElement, selection.getRangeAt(0).startContainer);
    if (!(currentBlock instanceof HTMLElement)) {
        return;
    }

    if (currentBlock.dataset.paginationSplitType === 'paragraph') {
        currentBlock.dataset.paginationBoundaryEdited = 'true';
    }
}

function removeTrailingCharacterFromBlock(editorElement, block) {
    if (!(block instanceof HTMLElement)) return false;

    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
        textNodes.push(currentNode);
        currentNode = walker.nextNode();
    }

    for (let i = textNodes.length - 1; i >= 0; i -= 1) {
        const value = textNodes[i].nodeValue || '';
        if (value.length === 0) {
            continue;
        }

        textNodes[i].nodeValue = value.slice(0, -1);
        if (textNodes[i].nodeValue.length === 0) {
            textNodes[i].remove();
        }

        ensureBlockHasEditablePosition(block);
        setCaretAtEndOfBlock(editorElement, block);
        return true;
    }

    return false;
}

function mergeParagraphLikeBlocks(editorElement, previousBlock, currentBlock, options) {
    const { trimLeadingWhitespace = false, absorbSplitContinuation = false } = options || {};

    if (absorbSplitContinuation) {
        absorbFollowingParagraphSplitBlocks(currentBlock, currentBlock, currentBlock);
    }

    if (trimLeadingWhitespace) {
        trimLeadingWhitespaceFromBlock(currentBlock);
    }

    const caretMarker = insertCommentMarkerAtBlockEnd(previousBlock, 'pagination-backspace-merge');

    appendBlockContentsWithBoundarySpace(previousBlock, currentBlock);
    currentBlock.remove();

    moveCaretToMarker(editorElement, caretMarker, 'backward');
}

function rebalanceParagraphBoundaryBackspace(editorElement, previousBlock, currentBlock, options) {
    const { deferCaretRestore = false } = options || {};
    const moved = window.EditorModules.paragraphSplit.moveLeadingWordToPreviousBlock(
        editorElement,
        previousBlock,
        currentBlock
    );

    if (!moved) {
        return false;
    }

    const caretMarker = insertCommentMarkerAtBlockEnd(previousBlock, 'pagination-backspace-word-merge');
    if (deferCaretRestore) {
        return caretMarker;
    }

    moveCaretToMarker(editorElement, caretMarker, 'backward');
    return caretMarker;
}

function mergeListBlocks(editorElement, previousBlock, currentBlock) {
    const previousList = getSingleDirectListElement(previousBlock);
    const currentList = getSingleDirectListElement(currentBlock);
    if (!previousList || !currentList) return false;

    const caretMarker = insertCommentMarkerAtBlockEnd(previousList, 'pagination-backspace-merge');

    while (currentList.firstChild) {
        previousList.appendChild(currentList.firstChild);
    }
    currentBlock.remove();

    moveCaretToMarker(editorElement, caretMarker, 'backward');
    return true;
}

function mergeListItemBoundaryBackspace(editorElement, previousBlock, currentBlock, range) {
    const previousList = getSingleDirectListElement(previousBlock);
    const currentList = getSingleDirectListElement(currentBlock);
    if (!previousList || !currentList) return false;

    const previousItems = getDirectListItems(previousList);
    const currentItems = getDirectListItems(currentList);
    if (previousItems.length === 0 || currentItems.length === 0) return false;

    const previousLastItem = previousItems[previousItems.length - 1];
    const currentFirstItem = currentItems[0];
    if (!(currentFirstItem.contains(range.startContainer) || currentFirstItem === range.startContainer)) {
        return false;
    }
    if (!isCaretAtStartOfBlock(currentFirstItem, range)) {
        return false;
    }

    const leadingWhitespaceLength = getLeadingWhitespaceLength(currentFirstItem);
    const caretLeadingWhitespaceOffset = getCaretLeadingWhitespaceOffset(currentFirstItem, range);
    if (
        leadingWhitespaceLength > 0 &&
        Number.isFinite(caretLeadingWhitespaceOffset) &&
        caretLeadingWhitespaceOffset > 0
    ) {
        return removeLeadingWhitespaceFromBlockAtOffset(
            editorElement,
            currentFirstItem,
            caretLeadingWhitespaceOffset
        );
    }

    if (isEffectivelyEmptyListItem(currentFirstItem)) {
        const caretMarker = insertCommentMarkerAtBlockEnd(previousLastItem, 'pagination-backspace-empty-list-item');
        currentFirstItem.remove();

        if (getDirectListItems(currentList).length === 0) {
            currentBlock.remove();
        }

        moveCaretToMarker(editorElement, caretMarker, 'backward');
        return true;
    }

    const caretMarker = insertCommentMarkerAtBlockEnd(previousLastItem, 'pagination-backspace-list-item-merge');

    while (currentFirstItem.firstChild) {
        previousLastItem.appendChild(currentFirstItem.firstChild);
    }
    currentFirstItem.remove();

    if (getDirectListItems(currentList).length === 0) {
        currentBlock.remove();
    }

    moveCaretToMarker(editorElement, caretMarker, 'backward');
    return true;
}

function handleBoundaryBackspace(editorElement) {
    if (activePageHeight === null || isPaginating) return false;

    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.startContainer)) {
        return false;
    }

    const currentBlock = getTopLevelEditorBlock(editorElement, range.startContainer);
    if (!(currentBlock instanceof HTMLElement)) {
        return false;
    }

    const previousBlock = getPreviousEditorBlock(currentBlock);
    const currentPageIndex = Number(currentBlock.dataset.pageIndex);
    if (!Number.isFinite(currentPageIndex)) {
        return false;
    }
    if (!(previousBlock instanceof HTMLElement)) {
        return false;
    }

    const previousPageIndex = Number(previousBlock.dataset.pageIndex);
    if (!Number.isFinite(previousPageIndex)) {
        return false;
    }

    const currentType = window.EditorModules.blockTypes.getContentElementType(currentBlock);
    const previousType = window.EditorModules.blockTypes.getContentElementType(previousBlock);
    const nextBlock = getNextEditorBlock(currentBlock);
    const hasParagraphContinuationOnLaterPage =
        currentType === 'paragraph' &&
        nextBlock instanceof HTMLElement &&
        currentBlock.dataset.paginationSplitType === 'paragraph' &&
        nextBlock.dataset.paginationSplitType === 'paragraph' &&
        currentBlock.dataset.paginationSplitGroup &&
        currentBlock.dataset.paginationSplitGroup === nextBlock.dataset.paginationSplitGroup &&
        Number(nextBlock.dataset.pageIndex) > currentPageIndex;

    if (currentPageIndex <= 1 && !hasParagraphContinuationOnLaterPage) {
        return false;
    }
    if (previousPageIndex > currentPageIndex) {
        return false;
    }
    if (previousPageIndex === currentPageIndex && !hasParagraphContinuationOnLaterPage) {
        return false;
    }

    const caretLeadingWhitespaceOffset = getCaretLeadingWhitespaceOffset(currentBlock, range);
    const firstListItem = currentType === 'list' ? getFirstDirectListItemFromBlock(currentBlock) : null;
    const isCaretAtListBoundaryStart =
        firstListItem instanceof HTMLElement && isCaretAtStartOfBlock(firstListItem, range);
    const isCaretAtBlockStart = isCaretAtStartOfBlock(currentBlock, range) || isCaretAtListBoundaryStart;

    let preserveParagraphSplitBoundaries = false;

    if (!isCaretAtBlockStart) {
        if (
            previousType === 'paragraph' &&
            currentType === 'paragraph' &&
            areBlocksFromSameParagraphSplit(previousBlock, currentBlock) &&
            Number.isFinite(caretLeadingWhitespaceOffset) &&
            caretLeadingWhitespaceOffset > 0
        ) {
            if (!removeLeadingWhitespaceFromBlockAtOffset(editorElement, currentBlock, caretLeadingWhitespaceOffset)) {
                return false;
            }

            applyPageBreaksForEditor({
                pageHeight: activePageHeight,
                preserveSelection: true,
                preserveParagraphSplitBoundaries: true
            });
            return true;
        }

        return false;
    }

    if (currentType === 'empty') {
        const shouldRestorePreviousBlockCaret =
            previousBlock instanceof HTMLElement &&
            nextBlock instanceof HTMLElement &&
            previousType === 'paragraph' &&
            nextBlock.dataset.paginationSplitType === 'paragraph' &&
            Number(nextBlock.dataset.pageIndex) === currentPageIndex &&
            Number(previousBlock.dataset.pageIndex) < currentPageIndex &&
            areBlocksFromSameParagraphSplit(previousBlock, nextBlock);

        if (shouldRestorePreviousBlockCaret) {
            const caretMarker = insertCommentMarkerAtBlockEnd(previousBlock, 'pagination-backspace-remove-empty');
            currentBlock.remove();
            moveCaretToMarker(editorElement, caretMarker, 'backward');

            applyPageBreaksForEditor({
                pageHeight: activePageHeight,
                preserveSelection: true,
                preserveParagraphSplitBoundaries: true
            });

            return true;
        }

        if (previousType === 'list') {
            const previousLastItem = getLastDirectListItemFromBlock(previousBlock);
            if (previousLastItem instanceof HTMLElement) {
                const caretMarker = insertCommentMarkerAtBlockEnd(
                    previousLastItem,
                    'pagination-backspace-remove-empty-list-exit'
                );
                currentBlock.remove();
                moveCaretToMarker(editorElement, caretMarker, 'backward');

                applyPageBreaksForEditor({
                    pageHeight: activePageHeight,
                    preserveSelection: true
                });

                return true;
            }
        }

        if (
            nextBlock instanceof HTMLElement &&
            Number(nextBlock.dataset.pageIndex) === currentPageIndex
        ) {
            const caretMarker = insertCommentMarkerAtBlockStart(nextBlock, 'pagination-backspace-remove-empty');
            currentBlock.remove();
            moveCaretToMarker(editorElement, caretMarker, 'forward');

            applyPageBreaksForEditor({
                pageHeight: activePageHeight,
                preserveSelection: true,
                preserveParagraphSplitBoundaries: true
            });

            return true;
        }
    }

    if (previousType === 'empty') {
        const caretMarker = insertCommentMarkerAtBlockStart(currentBlock, 'pagination-backspace-merge');
        previousBlock.remove();
        moveCaretToMarker(editorElement, caretMarker, 'forward');
    } else if (previousType === 'paragraph' && currentType === 'paragraph') {
        if (areBlocksFromSameParagraphSplit(previousBlock, currentBlock)) {
            const leadingWhitespaceLength = getLeadingWhitespaceLength(currentBlock);
            if (leadingWhitespaceLength > 0) {
                markBoundarySpaceRemoved(currentBlock);
                if (!removeOneLeadingWhitespaceFromBlock(editorElement, currentBlock)) {
                    return false;
                }

                applyPageBreaksForEditor({
                    pageHeight: activePageHeight,
                    preserveSelection: true,
                    preserveParagraphSplitBoundaries: false
                });
                markSelectionParagraphBoundaryEdited(editorElement);
                return true;
            }

            if (previousPageIndex < currentPageIndex) {
                markBoundarySpaceRemoved(currentBlock);
                if (removeTrailingCharacterFromBlock(editorElement, previousBlock)) {
                    applyPageBreaksForEditor({
                        pageHeight: activePageHeight,
                        preserveSelection: true,
                        preserveParagraphSplitBoundaries: false
                    });
                    markSelectionParagraphBoundaryEdited(editorElement);
                    return true;
                }
            }

            preserveParagraphSplitBoundaries = false;
            mergeParagraphLikeBlocks(editorElement, previousBlock, currentBlock, {
                trimLeadingWhitespace: true
            });
        } else {
            mergeParagraphLikeBlocks(editorElement, previousBlock, currentBlock, {
                absorbSplitContinuation: true
            });
        }
    } else if (previousType === 'paragraph' && (currentType === 'paragraph' || currentType === 'empty')) {
        mergeParagraphLikeBlocks(editorElement, previousBlock, currentBlock);
    } else if (previousType === 'list' && currentType === 'list' && canMergeListBlocks(previousBlock, currentBlock)) {
        if (!mergeListItemBoundaryBackspace(editorElement, previousBlock, currentBlock, range)) {
            mergeListBlocks(editorElement, previousBlock, currentBlock);
        }
    } else {
        return false;
    }

    applyPageBreaksForEditor({
        pageHeight: activePageHeight,
        preserveSelection: true,
        preserveParagraphSplitBoundaries
    });

    return true;
}

function handlePaginatedEnter(editorElement) {
    if (activePageHeight === null || isPaginating) return false;

    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.startContainer)) {
        return false;
    }

    const currentBlock = getTopLevelEditorBlock(editorElement, range.startContainer);
    if (!(currentBlock instanceof HTMLElement)) {
        return false;
    }

    const currentType = window.EditorModules.blockTypes.getContentElementType(currentBlock);
    if (currentType !== 'paragraph' && currentType !== 'empty') {
        return false;
    }

    const currentPageIndex = Number(currentBlock.dataset.pageIndex);
    const nextBlock = getNextEditorBlock(currentBlock);
    const previousBlock = getPreviousEditorBlock(currentBlock);
    const shouldForceFullRepagination =
        currentBlock.dataset.paginationBoundaryEdited === 'true' ||
        (previousBlock instanceof HTMLElement &&
            areBlocksFromSameParagraphSplit(previousBlock, currentBlock) &&
            currentBlock.dataset.paginationBoundaryEdited === 'true') ||
        (nextBlock instanceof HTMLElement &&
            areBlocksFromSameParagraphSplit(currentBlock, nextBlock) &&
            nextBlock.dataset.paginationBoundaryEdited === 'true');
    const isSplitParagraphBlock =
        Number.isFinite(currentPageIndex) &&
        currentBlock.dataset.paginationSplitType === 'paragraph';
    const isBoundaryEmptyParagraph =
        currentType === 'empty' &&
        Number.isFinite(currentPageIndex) &&
        currentPageIndex > 1 &&
        (
            (nextBlock instanceof HTMLElement &&
                nextBlock.dataset.paginationSplitType === 'paragraph' &&
                Number(nextBlock.dataset.pageIndex) === currentPageIndex) ||
            (previousBlock instanceof HTMLElement &&
                previousBlock.dataset.paginationSplitType === 'paragraph' &&
                Number(previousBlock.dataset.pageIndex) < currentPageIndex)
        );
    const shouldHandleAsPaginatedParagraph = isSplitParagraphBlock || isBoundaryEmptyParagraph;

    if (!shouldHandleAsPaginatedParagraph) {
        return false;
    }

    const isAtBlockStart = isCaretAtStartOfBlock(currentBlock, range);
    const isAtBlockEnd = isCaretAtEndOfBlock(currentBlock, range);
    let targetBlock = null;
    let caretBlock = null;

    if (isAtBlockStart) {
        targetBlock = createParagraphBlockClone(currentBlock);
        targetBlock.innerHTML = '<br>';
        currentBlock.insertAdjacentElement('beforebegin', targetBlock);
        caretBlock = currentBlock;
    } else if (isAtBlockEnd) {
        targetBlock = createParagraphBlockClone(currentBlock);
        targetBlock.innerHTML = '<br>';
        currentBlock.insertAdjacentElement('afterend', targetBlock);
        caretBlock = targetBlock;
    } else {
        const splitRange = range.cloneRange();
        splitRange.setEnd(currentBlock, currentBlock.childNodes.length);

        const remainderFragment = splitRange.extractContents();
        targetBlock = createParagraphBlockClone(currentBlock);
        targetBlock.appendChild(remainderFragment);
        moveTrailingWhitespaceToBlockStart(currentBlock, targetBlock);
        currentBlock.insertAdjacentElement('afterend', targetBlock);
        caretBlock = targetBlock;

        ensureBlockHasEditablePosition(currentBlock);
        ensureBlockHasEditablePosition(targetBlock);
    }

    if (targetBlock instanceof HTMLElement && targetBlock !== currentBlock && !isAtBlockStart) {
        absorbFollowingParagraphSplitBlocks(currentBlock, targetBlock, targetBlock);
    }

    const caretMarker = insertCommentMarkerAtBlockStart(caretBlock, 'pagination-enter');
    moveCaretToMarker(editorElement, caretMarker, 'forward');

    applyPageBreaksForEditor({
        pageHeight: activePageHeight,
        preserveSelection: true,
        preserveParagraphSplitBoundaries: !shouldForceFullRepagination
    });

    return true;
}

function shouldPreserveParagraphSplitBoundariesForSelection(editorElement) {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
        return false;
    }

    const range = selection.getRangeAt(0);
    if (!editorElement.contains(range.startContainer)) {
        return false;
    }

    const currentBlock = getTopLevelEditorBlock(editorElement, range.startContainer);
    if (!(currentBlock instanceof HTMLElement)) {
        return false;
    }

    const previousBlock = getPreviousEditorBlock(currentBlock);
    const nextBlock = getNextEditorBlock(currentBlock);

    const currentOrAdjacentBoundaryWasJoined =
        currentBlock.dataset.paginationBoundarySpaceBefore === 'false' ||
        currentBlock.dataset.paginationBoundaryEdited === 'true' ||
        (nextBlock instanceof HTMLElement &&
            areBlocksFromSameParagraphSplit(currentBlock, nextBlock) &&
            (
                nextBlock.dataset.paginationBoundarySpaceBefore === 'false' ||
                nextBlock.dataset.paginationBoundaryEdited === 'true'
            )) ||
        (previousBlock instanceof HTMLElement &&
            areBlocksFromSameParagraphSplit(previousBlock, currentBlock) &&
            (
                currentBlock.dataset.paginationBoundarySpaceBefore === 'false' ||
                currentBlock.dataset.paginationBoundaryEdited === 'true'
            ));

    if (currentOrAdjacentBoundaryWasJoined) {
        return false;
    }

    if (currentBlock.dataset.paginationSplitType === 'paragraph') {
        return true;
    }

    const currentPageIndex = Number(currentBlock.dataset.pageIndex);
    const previousPageIndex = Number(previousBlock?.dataset.pageIndex);
    const nextPageIndex = Number(nextBlock?.dataset.pageIndex);

    return (
        previousBlock instanceof HTMLElement &&
        nextBlock instanceof HTMLElement &&
        Number.isFinite(currentPageIndex) &&
        Number.isFinite(previousPageIndex) &&
        Number.isFinite(nextPageIndex) &&
        previousPageIndex < currentPageIndex &&
        nextPageIndex === currentPageIndex &&
        areBlocksFromSameParagraphSplit(previousBlock, nextBlock)
    );
}

function applyPageBreaksForEditor(options) {
    const {
        pageHeight,
        showAlert = false,
        logToConsole = false,
        preserveSelection = false,
        preserveParagraphSplitBoundaries = false
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
        const result = window.EditorModules.pagination.applyPageBreaks(editorElement, resolvedPageHeight, {
            preserveParagraphSplitBoundaries
        });
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
            preserveSelection: true,
            preserveParagraphSplitBoundaries: shouldPreserveParagraphSplitBoundariesForSelection(editor)
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

editor.addEventListener('keydown', function (event) {
    if (
        event.key === 'Enter' &&
        !event.defaultPrevented &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
    ) {
        if (handlePaginatedEnter(editor)) {
            event.preventDefault();
        }
        return;
    }

    if (
        event.key !== 'Backspace' ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
    ) {
        return;
    }

    if (handleBoundaryBackspace(editor)) {
        event.preventDefault();
    }
});

editor.addEventListener('input', function () {
    bindImageLoadListeners(editor);
    scheduleRealtimePagination();
});

