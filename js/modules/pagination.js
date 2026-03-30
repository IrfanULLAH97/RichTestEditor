function clearExistingPageBreakMarkers(editorElement) {
    const blocks = Array.from(editorElement.children);
    blocks.forEach((block) => {
        block.classList.remove('page-break-before');
        delete block.dataset.pageIndex;
    });
}

function applyPageBreaks(editorElement, pageHeight) {
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

