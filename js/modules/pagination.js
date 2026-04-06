function clearExistingPageBreakMarkers(editorElement) {
    const blocks = Array.from(editorElement.children);
    blocks.forEach((block) => {
        block.classList.remove('page-break-before');
        delete block.dataset.pageIndex;
    });
}

function removePageFillSpacers(editorElement) {
    Array.from(editorElement.querySelectorAll('[data-pagination-internal="page-fill-spacer"]'))
        .filter((block) => block instanceof HTMLElement)
        .forEach((block) => block.remove());
}

function cloneEmptyBlockLike(blockElement) {
    const clone = blockElement.cloneNode(false);
    clone.removeAttribute('data-page-index');
    clone.classList.remove('page-break-before');
    delete clone.dataset.paginationSplitType;
    delete clone.dataset.paginationSplitGroup;
    delete clone.dataset.paginationBoundarySpaceBefore;
    delete clone.dataset.paginationBoundaryEdited;
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

function getImageOnlyDirectChildHost(block) {
    return window.EditorModules.imageSplit.getDirectImageHost(block);
}

function getDirectImageHosts(block) {
    return window.EditorModules.imageSplit.getDirectImageHosts(block);
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

function blocksWereSeparatedByPageBoundary(currentBlock, nextBlock) {
    if (!(currentBlock instanceof HTMLElement) || !(nextBlock instanceof HTMLElement)) {
        return false;
    }

    if (nextBlock.classList.contains('page-break-before')) {
        return true;
    }

    const currentPageIndex = Number(currentBlock.dataset.pageIndex);
    const nextPageIndex = Number(nextBlock.dataset.pageIndex);

    return (
        Number.isFinite(currentPageIndex) &&
        Number.isFinite(nextPageIndex) &&
        currentPageIndex !== nextPageIndex
    );
}

function canMergeLists(currentList, nextList) {
    if (!currentList || !nextList) return false;
    if (currentList.tagName !== nextList.tagName) return false;
    if (currentList.className !== nextList.className) return false;
    if ((currentList.getAttribute('style') || '') !== (nextList.getAttribute('style') || '')) return false;
    return true;
}

function clearListItemSplitMetadata(listItem) {
    if (!(listItem instanceof HTMLLIElement)) {
        return;
    }

    delete listItem.dataset.paginationSplitType;
    delete listItem.dataset.paginationSplitGroup;
    delete listItem.dataset.paginationSplitContinuation;
    listItem.style.removeProperty('list-style-type');
}

function mergeListItemContinuationIfNeeded(currentList, nextList) {
    const currentItems = window.EditorModules.listSplit.getDirectListItems(currentList);
    const nextItems = window.EditorModules.listSplit.getDirectListItems(nextList);
    const lastCurrentItem = currentItems[currentItems.length - 1];
    const firstNextItem = nextItems[0];

    if (!(lastCurrentItem instanceof HTMLLIElement) || !(firstNextItem instanceof HTMLLIElement)) {
        return;
    }

    const sameSplitGroup =
        lastCurrentItem.dataset.paginationSplitType === 'list-item' &&
        firstNextItem.dataset.paginationSplitType === 'list-item' &&
        lastCurrentItem.dataset.paginationSplitGroup &&
        lastCurrentItem.dataset.paginationSplitGroup === firstNextItem.dataset.paginationSplitGroup;

    if (!sameSplitGroup || firstNextItem.dataset.paginationSplitContinuation !== 'true') {
        return;
    }

    Array.from(firstNextItem.childNodes).forEach((node) => lastCurrentItem.appendChild(node));
    clearListItemSplitMetadata(lastCurrentItem);
    firstNextItem.remove();
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

        if (!canMergeLists(currentList, nextList) || !blocksWereSeparatedByPageBoundary(currentBlock, nextBlock)) {
            i += 1;
            continue;
        }

        mergeListItemContinuationIfNeeded(currentList, nextList);
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

        if (!canMergeTables(currentTable, nextTable) || !blocksWereSeparatedByPageBoundary(currentBlock, nextBlock)) {
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

function hasMeaningfulDirectTextNode(element) {
    return Array.from(element.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );
}

function flattenNestedBlockWrappers(editorElement) {
    let changed = true;

    while (changed) {
        changed = false;

        Array.from(editorElement.children).forEach((block) => {
            if (!(block instanceof HTMLDivElement)) {
                return;
            }

            const nonBrChildren = Array.from(block.children).filter((el) => el.tagName !== 'BR');
            if (nonBrChildren.length !== 1) {
                return;
            }

            const onlyChild = nonBrChildren[0];
            if (!(onlyChild instanceof HTMLDivElement)) {
                return;
            }

            if (hasMeaningfulDirectTextNode(block)) {
                return;
            }

            // Keep intentionally structured content like lists/tables wrapped in place.
            if (onlyChild.querySelector('table, ul, ol')) {
                return;
            }

            const trailingBrNodes = Array.from(block.childNodes).filter(
                (node) => node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR'
            );

            while (onlyChild.firstChild) {
                block.insertBefore(onlyChild.firstChild, onlyChild);
            }

            onlyChild.remove();
            trailingBrNodes.forEach((node) => block.appendChild(node));
            changed = true;
        });
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

        const imageHosts = getDirectImageHosts(block);
        if (imageHosts.length === 0) {
            i += 1;
            continue;
        }

        const imageHost = imageHosts[0];

        const childNodes = Array.from(block.childNodes);
        const imageIdx = childNodes.indexOf(imageHost);
        if (imageIdx === -1) {
            i += 1;
            continue;
        }

        const beforeNodes = childNodes.slice(0, imageIdx);
        const afterNodes = childNodes.slice(imageIdx + 1);
        const hasBefore = beforeNodes.some(isMeaningfulNode);
        const hasAfter = afterNodes.some(isMeaningfulNode);
        const hasMultipleImageHosts = imageHosts.length > 1;

        if (!hasBefore && !hasAfter && !hasMultipleImageHosts) {
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
            if (n !== imageHost) n.remove();
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
        currentBlock.dataset.paginationSplitGroup === nextBlock.dataset.paginationSplitGroup &&
        blocksWereSeparatedByPageBoundary(currentBlock, nextBlock)
    );
}

function haveSameParagraphSplitGroup(currentBlock, nextBlock) {
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

function mergeParagraphSplitBlockContents(currentBlock, nextBlock) {
    const trailingCharacter = getTrailingTextCharacter(currentBlock);
    const leadingCharacter = getLeadingTextCharacter(nextBlock);
    const boundaryHasSpace = nextBlock.dataset.paginationBoundarySpaceBefore !== 'false';
    const shouldRestoreBoundarySpace =
        boundaryHasSpace &&
        trailingCharacter &&
        leadingCharacter &&
        !/\s/.test(trailingCharacter) &&
        !/\s/.test(leadingCharacter);

    if (shouldRestoreBoundarySpace) {
        currentBlock.appendChild(document.createTextNode(' '));
    }

    Array.from(nextBlock.childNodes).forEach((node) => currentBlock.appendChild(node));
    if (nextBlock.dataset.paginationBoundaryEdited === 'true') {
        currentBlock.dataset.paginationBoundaryEdited = 'true';
    }
}

function mergeParagraphSplitRemainderIntoFollowingBlock(remainderBlock, nextBlock) {
    if (!(remainderBlock instanceof HTMLElement) || !(nextBlock instanceof HTMLElement)) {
        return remainderBlock;
    }

    if (!haveSameParagraphSplitGroup(remainderBlock, nextBlock)) {
        return remainderBlock;
    }

    mergeParagraphSplitBlockContents(remainderBlock, nextBlock);
    nextBlock.replaceWith(remainderBlock);
    return remainderBlock;
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

        mergeParagraphSplitBlockContents(currentBlock, nextBlock);
        nextBlock.remove();
        // Keep same index to merge multi-page paragraph fragments back into one block.
    }
}

function clearParagraphSplitMarkers(editorElement) {
    Array.from(editorElement.children).forEach((block) => {
        if (!(block instanceof HTMLElement)) {
            return;
        }

        delete block.dataset.paginationSplitType;
        delete block.dataset.paginationSplitGroup;
        delete block.dataset.paginationBoundarySpaceBefore;
        delete block.dataset.paginationBoundaryEdited;
    });
}

function createPageSummary(pageIndex) {
    return {
        pageIndex,
        height: 0,
        blockCount: 0,
        blockTypes: [],
        oversizedContent: false,
        firstBlock: null
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
    if (!pageSummary.firstBlock) {
        pageSummary.firstBlock = block;
    }
    pageSummary.height = currentPageHeight;
    pageSummary.blockCount += 1;
    pageSummary.blockTypes.push(type);
    return pageSummary;
}

function createPageFillSpacer(heightPx, pageIndex) {
    const spacer = document.createElement('div');
    spacer.className = 'page-fill-spacer';
    spacer.dataset.paginationInternal = 'page-fill-spacer';
    spacer.dataset.pageIndex = String(pageIndex);
    spacer.contentEditable = 'false';
    spacer.style.height = `${Math.max(0, Math.ceil(heightPx))}px`;
    return spacer;
}

function applyFixedPageHeightSpacers(editorElement, pageSummaries, pageHeight) {
    pageSummaries.forEach((pageSummary, summaryIndex) => {
        if (summaryIndex === 0) {
            return;
        }

        const block = pageSummary.firstBlock;
        if (!(block instanceof HTMLElement)) {
            return;
        }

        const previousPageSummary = pageSummaries[summaryIndex - 1];
        if (!previousPageSummary) {
            return;
        }

        const spacerHeight = Math.max(0, pageHeight - previousPageSummary.height);
        if (spacerHeight <= 0) {
            return;
        }

        block.insertAdjacentElement(
            'beforebegin',
            createPageFillSpacer(spacerHeight, previousPageSummary.pageIndex)
        );
    });

    const lastPageSummary = pageSummaries[pageSummaries.length - 1];
    if (!lastPageSummary) {
        return;
    }

    const lastPageSpacerHeight = Math.max(0, pageHeight - lastPageSummary.height);
    if (lastPageSpacerHeight <= 0) {
        return;
    }

    editorElement.appendChild(createPageFillSpacer(lastPageSpacerHeight, lastPageSummary.pageIndex));
}

function applyPageBreaks(editorElement, pageHeight, options) {
    const { preserveParagraphSplitBoundaries = false } = options || {};

    removePageFillSpacers(editorElement);
    if (!preserveParagraphSplitBoundaries) {
        mergeAdjacentParagraphSplitBlocks(editorElement);
        clearParagraphSplitMarkers(editorElement);
    }
    mergeAdjacentTableBlocks(editorElement);
    mergeAdjacentListBlocks(editorElement);
    normalizeMixedTableBlocks(editorElement);
    normalizeMixedListBlocks(editorElement);
    flattenNestedBlockWrappers(editorElement);
    normalizeMixedImageBlocks(editorElement);
    clearExistingPageBreakMarkers(editorElement);

    let pageIndex = 1;
    let currentPageHeight = 0;
    let forceBreakBeforeNextBlock = false;
    let pendingPageBreak = false;
    const pageSummaries = [createPageSummary(pageIndex)];

    // Dynamic loop because we may insert blocks while paginating.
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        const type = window.EditorModules.blockTypes.getContentElementType(block);
        const isEmptyBlock = type === 'empty';
        const isSplittableType = type === 'paragraph' || type === 'list' || type === 'table';
        const canHostPageBreakMarker = !(block instanceof HTMLBRElement);

        if (forceBreakBeforeNextBlock) {
            pageIndex += 1;
            currentPageHeight = 0;
            forceBreakBeforeNextBlock = false;
            pendingPageBreak = true;
            if (!pageSummaries[pageIndex - 1]) {
                pageSummaries[pageIndex - 1] = createPageSummary(pageIndex);
            }
        }

        if (pendingPageBreak && canHostPageBreakMarker) {
            block.classList.add('page-break-before');
            pendingPageBreak = false;
        }

        const blockHeight = Math.ceil(block.getBoundingClientRect().height);

        const remaining = pageHeight - currentPageHeight;
        const wouldOverflowCurrentPage = currentPageHeight > 0 && currentPageHeight + blockHeight > pageHeight;
        const wouldOverflowFreshPage = currentPageHeight === 0 && isSplittableType && blockHeight > pageHeight;
        const shouldTrySplitOrMove = wouldOverflowCurrentPage || wouldOverflowFreshPage;

        if (shouldTrySplitOrMove) {
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

                    const followingBlock = block.nextElementSibling;
                    const targetRemainderBlock =
                        preserveParagraphSplitBoundaries &&
                        followingBlock instanceof HTMLElement
                            ? mergeParagraphSplitRemainderIntoFollowingBlock(remainderBlock, followingBlock)
                            : remainderBlock;

                    // Insert remainder as the next block; it starts on a new page.
                    block.insertAdjacentElement('afterend', targetRemainderBlock);
                    targetRemainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    pendingPageBreak = false;
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
                    pendingPageBreak = false;
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
                    pendingPageBreak = false;
                    i += 1;
                    continue;
                }
            }

            if (wouldOverflowCurrentPage) {
                // Default: move whole block to next page.
                pageIndex += 1;
                currentPageHeight = 0;
                pendingPageBreak = true;
                if (!pageSummaries[pageIndex - 1]) {
                    pageSummaries[pageIndex - 1] = createPageSummary(pageIndex);
                }
                // Re-evaluate this same block on a fresh page so splittable
                // content gets a chance to split against the full page height.
                continue;
            }
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

    applyFixedPageHeightSpacers(editorElement, pageSummaries, pageHeight);

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
