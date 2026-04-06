function hasNonEmptyDirectTextNode(element) {
    return Array.from(element.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );
}

function isImageOnlyElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element.tagName === 'IMG') return true;

    const wrappedChildren = Array.from(element.children).filter((el) => el.tagName !== 'BR');
    if (wrappedChildren.length !== 1) return false;
    if (hasNonEmptyDirectTextNode(element)) return false;

    const wrappedImage = wrappedChildren[0];
    if (wrappedImage.tagName !== 'IMG') return false;

    return true;
}

function getDirectImageHost(block) {
    const imageHosts = Array.from(block.children).filter((el) => el.tagName !== 'BR' && isImageOnlyElement(el));
    if (imageHosts.length !== 1) return null;
    return imageHosts[0];
}

function getDirectImageHosts(block) {
    return Array.from(block.children).filter((el) => el.tagName !== 'BR' && isImageOnlyElement(el));
}

function getImageOnlyDirectChildHost(block) {
    const imageHost = getDirectImageHost(block);
    if (!imageHost) return null;

    const nonBrChildren = Array.from(block.children).filter((el) => el.tagName !== 'BR');
    if (nonBrChildren.length !== 1) return null;
    if (hasNonEmptyDirectTextNode(block)) return null;

    return imageHost;
}

function getSingleDirectImage(block) {
    const imageHost = getImageOnlyDirectChildHost(block);
    if (!imageHost) return null;

    return imageHost.tagName === 'IMG'
        ? imageHost
        : Array.from(imageHost.children).find((el) => el.tagName === 'IMG') || null;
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.imageSplit = {
    getDirectImageHost,
    getDirectImageHosts,
    getImageOnlyDirectChildHost,
    getSingleDirectImage
};
