function isPaginationInternalElement(container) {
    return container instanceof HTMLElement && Boolean(container.dataset.paginationInternal);
}

function getContentElementType(container) {
    if (!(container instanceof HTMLElement)) {
        return 'unknown';
    }

    if (isPaginationInternalElement(container)) {
        return 'internal';
    }

    if (container.tagName === 'TABLE') {
        return 'table';
    }
    if (container.tagName === 'UL' || container.tagName === 'OL') {
        return 'list';
    }
    if (container.tagName === 'IMG') {
        return 'image';
    }

    const singleDirectTable = window.EditorModules?.tableSplit?.getSingleDirectTable?.(container);
    if (singleDirectTable) {
        return 'table';
    }

    const nonBrChildren = Array.from(container.children).filter((el) => el.tagName !== 'BR');
    const hasMeaningfulDirectText = Array.from(container.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );

    if (
        !hasMeaningfulDirectText &&
        nonBrChildren.length === 1 &&
        (nonBrChildren[0].tagName === 'UL' || nonBrChildren[0].tagName === 'OL')
    ) {
        return 'list';
    }

    if (
        !hasMeaningfulDirectText &&
        nonBrChildren.length === 1 &&
        (nonBrChildren[0].tagName === 'IMG' ||
            (
                nonBrChildren[0] instanceof HTMLElement &&
                nonBrChildren[0].children.length === 1 &&
                nonBrChildren[0].children[0].tagName === 'IMG' &&
                Array.from(nonBrChildren[0].childNodes).every(
                    (n) => n.nodeType !== Node.TEXT_NODE || !n.textContent || n.textContent.trim().length === 0
                )
            ))
    ) {
        return 'image';
    }

    if (container.querySelector('table')) {
        return 'table';
    }
    if (container.querySelector('ul, ol')) {
        return 'list';
    }

    const text = container.textContent ? container.textContent.trim() : '';
    if (text.length > 0) {
        return 'paragraph';
    }

    return 'empty';
}

function getEditorBlocksWithTypes(editorElement) {
    const blocks = Array.from(editorElement.children).filter((block) => !isPaginationInternalElement(block));
    return blocks.map((block, index) => ({
        index,
        element: block,
        type: getContentElementType(block)
    }));
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.blockTypes = {
    isPaginationInternalElement,
    getContentElementType,
    getEditorBlocksWithTypes
};

