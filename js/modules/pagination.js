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

function applyPageBreaks(editorElement, pageHeight) {
    mergeAdjacentListBlocks(editorElement);
    normalizeMixedListBlocks(editorElement);
    clearExistingPageBreakMarkers(editorElement);

    let pageIndex = 1;
    let currentPageHeight = 0;

    // Dynamic loop because we may insert blocks while paginating.
    let i = 0;
    while (i < editorElement.children.length) {
        const block = editorElement.children[i];
        const type = window.EditorModules.blockTypes.getContentElementType(block);
        const blockHeight = Math.ceil(block.getBoundingClientRect().height);

        const remaining = pageHeight - currentPageHeight;
        const wouldOverflow = currentPageHeight > 0 && currentPageHeight + blockHeight > pageHeight;

        if (wouldOverflow) {
            if (type === 'paragraph') {
                const remainderBlock = window.EditorModules.paragraphSplit.splitParagraphBlockToFit(
                    editorElement,
                    block,
                    remaining
                );
                if (remainderBlock) {
                    // Insert remainder as the next block; it starts on a new page.
                    block.insertAdjacentElement('afterend', remainderBlock);
                    remainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    remainderBlock.dataset.pageIndex = String(pageIndex);
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
                    block.insertAdjacentElement('afterend', remainderBlock);
                    remainderBlock.classList.add('page-break-before');
                    pageIndex += 1;
                    currentPageHeight = 0;
                    remainderBlock.dataset.pageIndex = String(pageIndex);
                    i += 1;
                    continue;
                }
            }

            // Default: move whole block to next page.
            pageIndex += 1;
            currentPageHeight = 0;
            block.classList.add('page-break-before');
        }

        block.dataset.pageIndex = String(pageIndex);
        currentPageHeight += Math.ceil(block.getBoundingClientRect().height);
        i += 1;
    }

    return { totalPages: pageIndex };
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.pagination = {
    applyPageBreaks
};

