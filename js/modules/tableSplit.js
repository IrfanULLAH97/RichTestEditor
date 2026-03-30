function ensureMeasureHost(editorElement) {
    let host = document.getElementById('__pageBreakMeasureHostTable');
    if (host) return host;

    host = document.createElement('div');
    host.id = '__pageBreakMeasureHostTable';
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.visibility = 'hidden';
    host.style.pointerEvents = 'none';
    host.style.zIndex = '-1';
    host.style.whiteSpace = 'normal';
    document.body.appendChild(host);

    const editorStyle = window.getComputedStyle(editorElement);
    host.style.font = editorStyle.font;
    host.style.letterSpacing = editorStyle.letterSpacing;
    host.style.wordSpacing = editorStyle.wordSpacing;
    host.style.lineHeight = editorStyle.lineHeight;
    host.style.padding = '0';
    host.style.border = '0';
    host.style.margin = '0';
    host.style.boxSizing = 'content-box';

    return host;
}

function setMeasureWidth(measureHost, editorElement) {
    const style = window.getComputedStyle(editorElement);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const contentWidth = Math.max(0, editorElement.clientWidth - padL - padR);
    measureHost.style.width = `${contentWidth}px`;
}

function measureHeightForClone(editorElement, blockClone) {
    const host = ensureMeasureHost(editorElement);
    setMeasureWidth(host, editorElement);

    if (blockClone.classList.contains('page-break-before')) {
        // Detached measure hosts are outside `#editor`, so mirror the
        // page-break padding/border that affect real block height.
        blockClone.style.borderTop = '2px dashed transparent';
        blockClone.style.paddingTop = '18px';
        blockClone.style.position = 'relative';
    }

    host.replaceChildren(blockClone);
    return Math.ceil(blockClone.getBoundingClientRect().height);
}

function getDirectBodyRows(tableElement) {
    const rows = [];
    if (tableElement.tBodies && tableElement.tBodies.length > 0) {
        Array.from(tableElement.tBodies).forEach((tbody) => {
            Array.from(tbody.rows).forEach((row) => rows.push(row));
        });
        return rows;
    }

    try {
        return Array.from(tableElement.querySelectorAll(':scope > tr'));
    } catch {
        return Array.from(tableElement.children).filter((el) => el.tagName === 'TR');
    }
}

function getSingleDirectTable(block) {
    const nonBrChildren = Array.from(block.children).filter((el) => el.tagName !== 'BR');
    if (nonBrChildren.length !== 1) return null;
    const onlyChild = nonBrChildren[0];
    if (onlyChild.tagName !== 'TABLE') return null;

    const hasNonEmptyTextNode = Array.from(block.childNodes).some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim().length > 0
    );
    if (hasNonEmptyTextNode) return null;

    return onlyChild;
}

function trimTableCloneToRowCount(blockClone, rowCount) {
    const table = blockClone.querySelector('table');
    if (!table) return;
    const rows = getDirectBodyRows(table);
    for (let i = rows.length - 1; i >= rowCount; i -= 1) {
        rows[i].remove();
    }
}

function removeFirstNRows(blockClone, rowCount) {
    const table = blockClone.querySelector('table');
    if (!table) return;
    const rows = getDirectBodyRows(table);
    for (let i = 0; i < Math.min(rowCount, rows.length); i += 1) {
        rows[i].remove();
    }
}

function splitTableBlockToFit(editorElement, blockElement, maxHeightPx) {
    if (maxHeightPx <= 0) return null;

    const table = getSingleDirectTable(blockElement);
    if (!table) return null;

    const rows = getDirectBodyRows(table);
    if (rows.length <= 1) return null;

    const probeClone = blockElement.cloneNode(true);
    trimTableCloneToRowCount(probeClone, 1);
    if (measureHeightForClone(editorElement, probeClone) > maxHeightPx) {
        return null;
    }

    let low = 1;
    let high = rows.length;
    let best = 1;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const clone = blockElement.cloneNode(true);
        trimTableCloneToRowCount(clone, mid);
        const h = measureHeightForClone(editorElement, clone);
        if (h <= maxHeightPx) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    if (best >= rows.length) return null;

    const remainderBlock = blockElement.cloneNode(true);
    trimTableCloneToRowCount(blockElement, best);
    removeFirstNRows(remainderBlock, best);

    const remainderTable = remainderBlock.querySelector('table');
    if (!remainderTable || getDirectBodyRows(remainderTable).length === 0) {
        return null;
    }

    return remainderBlock;
}

window.EditorModules = window.EditorModules || {};
window.EditorModules.tableSplit = {
    splitTableBlockToFit,
    getSingleDirectTable,
    getDirectBodyRows
};

