function getContentElementType(container) {
    if (!(container instanceof HTMLElement)) {
        return 'unknown';
    }

    if (container.querySelector('table')) {
        return 'table';
    }
    if (container.querySelector('ul, ol')) {
        return 'list';
    }
    if (container.querySelector('img')) {
        return 'image';
    }

    const text = container.textContent ? container.textContent.trim() : '';
    if (text.length > 0) {
        return 'paragraph';
    }

    return 'empty';
}

function getEditorBlocksWithTypes(editorElement) {
    const blocks = Array.from(editorElement.children);
    return blocks.map((block, index) => ({
        index,
        element: block,
        type: getContentElementType(block)
    }));
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.blockTypes = {
    getContentElementType,
    getEditorBlocksWithTypes
};

