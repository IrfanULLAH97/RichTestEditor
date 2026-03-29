function formatText(command) {
    document.execCommand(command, false, null);
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
    // Create a new list item and set cursor inside it.
    const newItem = document.createElement('li');
    newItem.appendChild(document.createElement('br'));
    list.appendChild(newItem);
    // Set cursor to the new item.
    const newRange = document.createRange();
    newRange.setStart(newItem, 0);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);
}
function insertImage() {
    const imageUrl = prompt('Please enter the image URL:');
    if (imageUrl) {
        const img = `<img src="${imageUrl}" alt="Inserted image" style="max-width: 100%; height: auto;">`;
        document.execCommand('insertHTML', false, img);
    }
}
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
function setPageBreak() {
    const pageHeight = parseInt(document.getElementById('pageHeight').value, 10);
    const editorElement = document.getElementById('editor');
    if (Number.isNaN(pageHeight) || pageHeight <= 0) {
        alert('Please enter a valid page height in pixels.');
        return;
    }
    const typedBlocks = getEditorBlocksWithTypes(editorElement);
    // Step 1: detect block types; next step will split/move content by type.
    console.table(
        typedBlocks.map((block) => ({
            index: block.index,
            type: block.type,
            height: Math.round(block.element.getBoundingClientRect().height)
        }))
    );
}
const editor = document.getElementById('editor');
editor.addEventListener(
    'focus',
    function () {
        if (editor.textContent === 'Start typing here...') {
            editor.textContent = '';
        }
    },
    { once: true }
);
