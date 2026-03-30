function getSingleDirectImage(block) {
    const nonBrChildren = Array.from(block.children).filter((el) => el.tagName !== 'BR');
    if (nonBrChildren.length !== 1) return null;
    const onlyChild = nonBrChildren[0];
    if (onlyChild.tagName !== 'IMG') return null;

    const hasNonEmptyTextNode = Array.from(block.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );
    if (hasNonEmptyTextNode) return null;

    return onlyChild;
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.imageSplit = {
    getSingleDirectImage
};

