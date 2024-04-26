import { useDocument, useHandle } from '@automerge/automerge-repo-react-hooks';
import { AmbSheetDoc, AmbSheetDocAnchor } from '../datatype';

import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import { useMemo, useState } from 'react';

import * as A from '@automerge/automerge/next';
import { registerRenderer, textRenderer } from 'handsontable/renderers';
import { DocEditorProps } from '@/DocExplorer/doctypes';
import { AmbContext, NOT_READY, Value, evalSheet, filter } from '../eval';
import { FormulaEditor } from '../formulaEditor';
import { isFormula } from '../parse';

// register Handsontable's modules
registerAllModules();

registerRenderer('addedCell', (hotInstance, TD, ...rest) => {
  textRenderer(hotInstance, TD, ...rest);

  TD.style.outline = 'solid 1px rgb(0 100 0 / 80%)';
  TD.style.background = 'rgb(0 255 0 / 10%)';
});

registerRenderer(
  'amb',
  (instance, td, row, col, prop, value, cellProperties) => {
    const selectedValueIndexes =
      instance.getCellMeta(row, col)['selectedValueIndexes'] || [];
    if (value === null) {
      td.innerText = '';
      return td;
    }

    if (value === NOT_READY) {
      // todo: is this right? need to consider when NOT_READY gets returned...
      td.innerText = '!ERROR';
      return td;
    }

    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.justifyContent = 'flex-start';
    container.style.alignItems = 'center';
    container.style.fontSize = '16px';

    // Adjusting styles to compensate for removed gap
    container.className = 'value-container';
    const style = document.createElement('style');
    style.innerHTML = `
      .value-container::after {
        content: '';
        height: 100%;
        border-right: 1px solid #ddd;
      }
      .value-container > div:not(:last-child)::after {
        content: '';
        position: absolute;
        right: 0; /* adjusted for removed gap */
        height: 100%;
        border-right: 1px solid #ddd;
      }
      .value-container > div {
        position: relative;
      }
    `;
    document.head.appendChild(style);

    value.forEach((val, i) => {
      const valueElement = document.createElement('div');
      valueElement.innerText = val.value.rawValue;
      valueElement.style.padding = '1px 4px';
      valueElement.setAttribute('data-context', JSON.stringify(val.context));
      if (!val.include) {
        valueElement.style.color = '#ddd';
      }
      if (selectedValueIndexes.includes(i)) {
        valueElement.style.background = 'rgb(255 0 0 / 10%)';
      }
      valueElement.addEventListener('click', () => {
        const valueIndex = selectedValueIndexes.indexOf(i);
        if (valueIndex > -1) {
          selectedValueIndexes.splice(valueIndex, 1); // Remove the value if it's already in the array
        } else {
          selectedValueIndexes.push(i); // Add the value if it's not in the array
        }
        instance.setCellMeta(
          row,
          col,
          'selectedValueIndexes',
          selectedValueIndexes
        );
      });
      container.appendChild(valueElement);
    });
    td.innerHTML = '';
    td.appendChild(container);

    return td;
  }
);

// Here's an overview of how formula evaluation works:
// - The raw document stores cells as text, including formulas
// - The data we pass into HOT contains evaluated formula results
// - We also pass in formula text as secondary cell metadata

export const AmbSheet = ({
  docUrl,
  docHeads,
  annotations = [],
}: DocEditorProps<AmbSheetDocAnchor, string>) => {
  const [latestDoc] = useDocument<AmbSheetDoc>(docUrl); // used to trigger re-rendering when the doc loads
  const handle = useHandle<AmbSheetDoc>(docUrl);
  const [selectedValuesForCells, setSelectedValuesForCells] = useState<
    { row: number; col: number; selectedValueIndexes: number[] }[]
  >([]);

  console.log({ selectedValuesForCells });

  const doc = useMemo(
    () => (docHeads ? A.view(latestDoc, docHeads) : latestDoc),
    [latestDoc, docHeads]
  );

  const evaluatedSheet = useMemo(() => {
    if (!doc) {
      return [];
    }
    return evalSheet(doc.data).results;
  }, [doc]);

  const filteredResults = useMemo(() => {
    const filterContexts = selectedValuesForCells.map((f) => {
      return f.selectedValueIndexes.map(
        (i) => evaluatedSheet[f.row][f.col][i].context
      );
    });
    return filter(evaluatedSheet, filterContexts);
  }, [evaluatedSheet, selectedValuesForCells]);

  const onBeforeHotChange = (changes) => {
    handle.change((doc) => {
      changes.forEach(([row, column, , newValue]) => {
        if (column > doc.data[0].length) {
          doc.data[0][column] = '';
        }
        if (!doc.data[row]) {
          doc.data[row] = new Array(column).fill(null);
        }
        doc.data[row][column] = newValue;
      });
    });
    return false;
  };

  const onAfterSetCellMeta = (row, col, _, value) => {
    const existingEntryIndex = selectedValuesForCells.findIndex(
      (entry) => entry.row === row && entry.col === col
    );
    if (existingEntryIndex !== -1) {
      if (value.length === 0) {
        // Clear out the existing entry if the value is an empty array
        setSelectedValuesForCells(
          selectedValuesForCells.filter(
            (_, index) => index !== existingEntryIndex
          )
        );
      } else {
        // Update existing entry
        const updatedEntry = {
          ...selectedValuesForCells[existingEntryIndex],
          selectedValueIndexes: value,
        };
        const newFilterContextsForCells = [...selectedValuesForCells];
        newFilterContextsForCells[existingEntryIndex] = updatedEntry;
        setSelectedValuesForCells(newFilterContextsForCells);
      }
    } else if (value.length > 0) {
      // Add new entry only if value is not an empty array
      setSelectedValuesForCells([
        ...selectedValuesForCells,
        { row, col, selectedValueIndexes: value },
      ]);
    }
  };
  const onBeforeCreateRow = (index, amount) => {
    handle.change((doc) => {
      doc.data.splice(
        index,
        0,
        ...new Array(amount).fill(new Array(doc.data[0].length).fill(null))
      );
    });
    return false;
  };

  const onBeforeCreateCol = (index, amount) => {
    handle.change((doc) => {
      doc.data.forEach((row) => {
        row.splice(index, 0, ...new Array(amount).fill(null));
      });
    });
    return false;
  };

  if (!doc) {
    return null;
  }

  return (
    <div className="w-full h-full overflow-hidden">
      <HotTable
        data={filteredResults}
        editor={FormulaEditor}
        beforeChange={onBeforeHotChange}
        beforeCreateRow={onBeforeCreateRow}
        beforeCreateCol={onBeforeCreateCol}
        afterSetCellMeta={onAfterSetCellMeta}
        rowHeaders={true}
        colHeaders={true}
        contextMenu={true}
        width="100%"
        height="100%"
        autoWrapRow={false}
        autoWrapCol={false}
        licenseKey="non-commercial-and-evaluation"
        renderer="amb"
        // Attach raw formula results to the cell metadata
        cells={(row, col) => {
          const rawContents = doc.data[row][col];
          const selectedValueIndexes =
            selectedValuesForCells.find((f) => f.row === row && f.col === col)
              ?.selectedValueIndexes || [];
          if (isFormula(rawContents)) {
            return { formula: rawContents, selectedValueIndexes };
          }
        }}
      />
    </div>
  );
};