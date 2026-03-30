function clearExistingPageBreakMarkers(editorElement) {
    const blocks = Array.from(editorElement.children);
    blocks.forEach((block) => {
        block.classList.remove('page-break-before');
        delete block.dataset.pageIndex;
    });
}

function cloneEmptyBlockLike(blockElement) {
    const clone = blockElement.cloneNode(false);
    clone.removeAttribute('data-page-index');
    clone.classList.remove('page-break-before');
    delete clone.dataset.paginationSplitType;
    delete clone.dataset.paginationSplitGroup;
    return clone;
}

function isMeaningfulNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.textContent && node.textContent.trim().length > 0);
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node;
        if (el.tagName === 'BR') return false;
        return true;
    }
    return false;
}

function getSingleDirectTable(block) {
    return window.EditorModules.tableSplit.getSingleDirectTable(block);
}

function getSingleDirectImage(block) {
    return window.EditorModules.imageSplit.getSingleDirectImage(block);
}

function getSingleDirectList(block) {
    const nonBrChildren = Array.from(block.children).filter((el) => el.tagName !== 'BR');
    if (nonBrChildren.length !== 1) return null;
    const onlyChild = nonBrChildren[0];
    if (onlyChild.tagName !== 'UL' && onlyChild.tagName !== 'OL') return null;

    const hasNonEmptyTextNode = Array.from(block.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );
    if (hasNonEmptyTextNode) return null;

    return onlyChild;
}

function canMergeLists(currentList, nextList) {
    if (!currentList || !nextList) return false;
    if (currentList.tagName !== nextList.tagName) return false;
    if (currentList.className !== nextList.className) return false;
    if ((currentList.getAttribute('style') || '') !== (nextList.getAttribute('style') || '')) return false;
    return true;
}

// When page height changes, previously split lists may stay fragmented.
// Merge adjacent compatible list blocks first to avoid stale visual gaps.
function mergeAdjacentListBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length - 1) {
        const currentBlock = editorElement.children[i];
        const nextBlock = editorElement.children[i + 1];

        const currentList = getSingleDirectList(currentBlock);
        const nextList = getSingleDirectList(nextBlock);

        if (!canMergeLists(currentList, nextList)) {
            i += 1;
            continue;
        }

        Array.from(nextList.children).forEach((child) => currentList.appendChild(child));
        nextBlock.remove();
        // Keep same index to merge multiple following list fragments.
    }
}

function canMergeTables(currentTable, nextTable) {
    if (!currentTable || !nextTable) return false;
    if (currentTable.className !== nextTable.className) return false;
    if ((currentTable.getAttribute('style') || '') !== (nextTable.getAttribute('style') || '')) return false;
    if ((currentTable.getAttribute('border') || '') !== (nextTable.getAttribute('border') || '')) return false;
    return true;
}

function mergeAdjacentTableBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length - 1) {
        const currentBlock = editorElement.children[i];
        const nextBlock = editorElement.children[i + 1];
        const currentTable = getSingleDirectTable(currentBlock);
        const nextTable = getSingleDirectTable(nextBlock);

        if (!canMergeTables(currentTable, nextTable)) {
            i += 1;
            continue;
        }

        const nextRows = window.EditorModules.tableSplit.getDirectBodyRows(nextTable);
        if (nextRows.length === 0) {
            nextBlock.remove();
            continue;
        }

        let targetContainer = currentTable.tBodies && currentTable.tBodies.length > 0
            ? currentTable.tBodies[currentTable.tBodies.length - 1]
            : currentTable;

        nextRows.forEach((row) => targetContainer.appendChild(row));
        nextBlock.remove();
    }
}

// Split blocks like: <div><ul>...</ul>some text...</div>
// into: <div><ul>...</ul></div><div>some text...</div> (preserving order).
function normalizeMixedListBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        if (!(block instanceof HTMLElement)) {
            i += 1;
            continue;
        }

        const directLists = Array.from(block.children).filter(
            (el) => el.tagName === 'UL' || el.tagName === 'OL'
        );
        if (directLists.length === 0) {
            i += 1;
            continue;
        }

        const listEl = directLists[0];
        const childNodes = Array.from(block.childNodes);
        const listIdx = childNodes.indexOf(listEl);
        if (listIdx === -1) {
            i += 1;
            continue;
        }

        const beforeNodes = childNodes.slice(0, listIdx);
        const afterNodes = childNodes.slice(listIdx + 1);

        const hasBefore = beforeNodes.some(isMeaningfulNode);
        const hasAfter = afterNodes.some(isMeaningfulNode);

        if (!hasBefore && !hasAfter) {
            i += 1;
            continue;
        }

        let beforeBlock = null;
        let afterBlock = null;

        if (hasBefore) {
            beforeBlock = cloneEmptyBlockLike(block);
            beforeNodes.forEach((n) => beforeBlock.appendChild(n));
            block.insertAdjacentElement('beforebegin', beforeBlock);
            i += 1; // Skip over the newly inserted beforeBlock.
        }

        if (hasAfter) {
            afterBlock = cloneEmptyBlockLike(block);
            afterNodes.forEach((n) => afterBlock.appendChild(n));
            block.insertAdjacentElement('afterend', afterBlock);
        }

        // Ensure the original block only contains the list.
        Array.from(block.childNodes).forEach((n) => {
            if (n !== listEl) n.remove();
        });

        // Re-run normalization on the newly created afterBlock if it still contains mixed lists.
        if (afterBlock) {
            // Do not advance i so the next iteration processes the block (list-only) then afterBlock.
        } else {
            i += 1;
        }
    }
}

function normalizeMixedTableBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        if (!(block instanceof HTMLElement)) {
            i += 1;
            continue;
        }

        const directTables = Array.from(block.children).filter((el) => el.tagName === 'TABLE');
        if (directTables.length === 0) {
            i += 1;
            continue;
        }

        const tableEl = directTables[0];
        const childNodes = Array.from(block.childNodes);
        const tableIdx = childNodes.indexOf(tableEl);
        if (tableIdx === -1) {
            i += 1;
            continue;
        }

        const beforeNodes = childNodes.slice(0, tableIdx);
        const afterNodes = childNodes.slice(tableIdx + 1);
        const hasBefore = beforeNodes.some(isMeaningfulNode);
        const hasAfter = afterNodes.some(isMeaningfulNode);

        if (!hasBefore && !hasAfter) {
            i += 1;
            continue;
        }

        let afterBlock = null;
        if (hasBefore) {
            const beforeBlock = cloneEmptyBlockLike(block);
            beforeNodes.forEach((n) => beforeBlock.appendChild(n));
            block.insertAdjacentElement('beforebegin', beforeBlock);
            i += 1;
        }
        if (hasAfter) {
            afterBlock = cloneEmptyBlockLike(block);
            afterNodes.forEach((n) => afterBlock.appendChild(n));
            block.insertAdjacentElement('afterend', afterBlock);
        }

        Array.from(block.childNodes).forEach((n) => {
            if (n !== tableEl) n.remove();
        });

        if (!afterBlock) {
            i += 1;
        }
    }
}

function normalizeMixedImageBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        if (!(block instanceof HTMLElement)) {
            i += 1;
            continue;
        }

        const directImages = Array.from(block.children).filter((el) => el.tagName === 'IMG');
        if (directImages.length === 0) {
            i += 1;
            continue;
        }

        const imageEl = directImages[0];
        const childNodes = Array.from(block.childNodes);
        const imageIdx = childNodes.indexOf(imageEl);
        if (imageIdx === -1) {
            i += 1;
            continue;
        }

        const beforeNodes = childNodes.slice(0, imageIdx);
        const afterNodes = childNodes.slice(imageIdx + 1);
        const hasBefore = beforeNodes.some(isMeaningfulNode);
        const hasAfter = afterNodes.some(isMeaningfulNode);

        if (!hasBefore && !hasAfter) {
            i += 1;
            continue;
        }

        let afterBlock = null;
        if (hasBefore) {
            const beforeBlock = cloneEmptyBlockLike(block);
            beforeNodes.forEach((n) => beforeBlock.appendChild(n));
            block.insertAdjacentElement('beforebegin', beforeBlock);
            i += 1;
        }
        if (hasAfter) {
            afterBlock = cloneEmptyBlockLike(block);
            afterNodes.forEach((n) => afterBlock.appendChild(n));
            block.insertAdjacentElement('afterend', afterBlock);
        }

        Array.from(block.childNodes).forEach((n) => {
            if (n !== imageEl) n.remove();
        });

        if (!afterBlock) {
            i += 1;
        }
    }
}

let paragraphSplitGroupCounter = 0;

function nextParagraphSplitGroupId() {
    paragraphSplitGroupCounter += 1;
    return `paragraph-split-${paragraphSplitGroupCounter}`;
}

function markParagraphSplitBlocks(currentBlock, remainderBlock) {
    const existingGroupId =
        currentBlock.dataset.paginationSplitType === 'paragraph' ? currentBlock.dataset.paginationSplitGroup : '';
    const groupId = existingGroupId || nextParagraphSplitGroupId();

    currentBlock.dataset.paginationSplitType = 'paragraph';
    currentBlock.dataset.paginationSplitGroup = groupId;
    remainderBlock.dataset.paginationSplitType = 'paragraph';
    remainderBlock.dataset.paginationSplitGroup = groupId;
}

function canMergeParagraphSplitBlocks(currentBlock, nextBlock) {
    if (!(currentBlock instanceof HTMLElement) || !(nextBlock instanceof HTMLElement)) {
        return false;
    }

    return (
        currentBlock.dataset.paginationSplitType === 'paragraph' &&
        nextBlock.dataset.paginationSplitType === 'paragraph' &&
        currentBlock.dataset.paginationSplitGroup &&
        currentBlock.dataset.paginationSplitGroup === nextBlock.dataset.paginationSplitGroup
    );
}

function mergeAdjacentParagraphSplitBlocks(editorElement) {
    let i = 0;
    while (i < editorElement.children.length - 1) {
        const currentBlock = editorElement.children[i];
        const nextBlock = editorElement.children[i + 1];

        if (!canMergeParagraphSplitBlocks(currentBlock, nextBlock)) {
            i += 1;
            continue;
        }

        Array.from(nextBlock.childNodes).forEach((node) => currentBlock.appendChild(node));
        nextBlock.remove();
        // Keep same index to merge multi-page paragraph fragments back into one block.
    }
}

function createPageSummary(pageIndex) {
    return {
        pageIndex,
        height: 0,
        blockCount: 0,
        blockTypes: [],
        oversizedContent: false
    };
}

function ensurePageSummary(pageSummaries, pageIndex) {
    const summaryIndex = pageIndex - 1;
    if (!pageSummaries[summaryIndex]) {
        pageSummaries[summaryIndex] = createPageSummary(pageIndex);
    }
    return pageSummaries[summaryIndex];
}

function recordBlockOnPage(block, type, pageIndex, currentPageHeight, pageSummaries) {
    block.dataset.pageIndex = String(pageIndex);
    const pageSummary = ensurePageSummary(pageSummaries, pageIndex);
    pageSummary.height = currentPageHeight;
    pageSummary.blockCount += 1;
    pageSummary.blockTypes.push(type);
    return pageSummary;
}

function applyPageBreaks(editorElement, pageHeight) {
    mergeAdjacentParagraphSplitBlocks(editorElement);
    mergeAdjacentTableBlocks(editorElement);
    mergeAdjacentListBlocks(editorElement);
    normalizeMixedTableBlocks(editorElement);
    normalizeMixedListBlocks(editorElement);
    normalizeMixedImageBlocks(editorElement);
    clearExistingPageBreakMarkers(editorElement);

    let pageIndex = 1;
    let currentPageHeight = 0;
    let forceBreakBeforeNextBlock = false;
    const pageSummaries = [createPageSummary(pageIndex)];

    // Dynamic loop because we may insert blocks while paginating.
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        const type = window.EditorModules.blockTypes.getContentElementType(block);
        const blockHeight = Math.ceil(block.getBoundingClientRect().height);
        const isEmptyBlock = type === 'empty';

        if (forceBreakBeforeNextBlock) {
            if (isEmptyBlock) {
                block.remove();
                continue;
            }

            pageIndex += 1;
            currentPageHeight = 0;
            block.classList.add('page-break-before');
            forceBreakBeforeNextBlock = false;
            if (!pageSummaries[pageIndex - 1]) {
                pageSummaries[pageIndex - 1] = createPageSummary(pageIndex);
            }
        }

        const remaining = pageHeight - currentPageHeight;
        const wouldOverflow = currentPageHeight > 0 && currentPageHeight + blockHeight > pageHeight;

        if (wouldOverflow && isEmptyBlock) {
            block.remove();
            continue;
        }

        if (wouldOverflow) {
            if (type === 'paragraph') {
                const remainderBlock = window.EditorModules.paragraphSplit.splitParagraphBlockToFit(
                    editorElement,
                    block,
                    remaining
                );
                if (remainderBlock) {
                    markParagraphSplitBlocks(block, remainderBlock);
                    currentPageHeight += Math.ceil(block.getBoundingClientRect().height);
                    recordBlockOnPage(block, type, pageIndex, currentPageHeight, pageSummaries);

                    // Insert remainder as the next block; it starts on a new page.
                    block.insertAdjacentElement('afterend', remainderBlock);
                    remainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    // Move on to the remainder block (top of next page).
                    i += 1;
                    continue;
                }
            }
            if (type === 'list') {
                const remainderBlock = window.EditorModules.listSplit.splitListBlockToFit(
                    editorElement,
                    block,
                    remaining
                );
                if (remainderBlock) {
                    currentPageHeight += Math.ceil(block.getBoundingClientRect().height);
                    recordBlockOnPage(block, type, pageIndex, currentPageHeight, pageSummaries);

                    block.insertAdjacentElement('afterend', remainderBlock);
                    remainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    i += 1;
                    continue;
                }
            }
            if (type === 'table') {
                const remainderBlock = window.EditorModules.tableSplit.splitTableBlockToFit(
                    editorElement,
                    block,
                    remaining
                );
                if (remainderBlock) {
                    currentPageHeight += Math.ceil(block.getBoundingClientRect().height);
                    recordBlockOnPage(block, type, pageIndex, currentPageHeight, pageSummaries);

                    block.insertAdjacentElement('afterend', remainderBlock);
                    remainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    i += 1;
                    continue;
                }
            }

            // Default: move whole block to next page.
            pageIndex += 1;
            currentPageHeight = 0;
            block.classList.add('page-break-before');
        }

        currentPageHeight += Math.ceil(block.getBoundingClientRect().height);
        const currentPageSummary = recordBlockOnPage(block, type, pageIndex, currentPageHeight, pageSummaries);

        // Oversized images keep original size and occupy their own page;
        // force the following block to start on a fresh page.
        if (type === 'image' && blockHeight > pageHeight) {
            forceBreakBeforeNextBlock = true;
            currentPageSummary.oversizedContent = true;
        }

        i += 1;
    }

    return {
        totalPages: pageIndex,
        pageSummaries: pageSummaries.map((summary) => ({
            pageIndex: summary.pageIndex,
            height: summary.height,
            limit: pageHeight,
            deltaFromLimit: summary.height - pageHeight,
            blockCount: summary.blockCount,
            blockTypes: summary.blockTypes.join(', '),
            oversizedContent: summary.oversizedContent
        }))
    };
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.pagination = {
    applyPageBreaks
};
