import React, { useMemo } from 'react';
import { Value } from '../eval';
import { groupBy } from 'lodash';
import { FilterSelection } from './AmbSheet';

export const Stacks = ({
  values,
  filterSelection,
  setFilterSelection,
}: {
  values: Value[];
  filterSelection: FilterSelection;
  setFilterSelection: (selectedIndexes: number[]) => void;
}) => {
  const groupedValues = useMemo(() => {
    return groupBy(
      values.map((v, i) => ({ ...v, indexInCell: i })),
      (value) => value.rawValue
    );
  }, [values]);

  const selectGroup = (groupValue: any) => {
    const group = groupedValues[groupValue];
    if (!group) return;
    const selectedIndexes = group.map((v) => v.indexInCell);
    setFilterSelection(selectedIndexes);
  };

  return (
    <div className="flex flex-wrap gap-2 mb-10">
      {Object.entries(groupedValues).map(([key, values]) => {
        const stackSize = Math.min(values.length, 4);
        return (
          <div
            key={key}
            className="w-10 h-8 relative cursor-default"
            onMouseEnter={() => selectGroup(key)}
            onMouseLeave={() => setFilterSelection(null)}
          >
            <div className="h-7">
              {Array.from({ length: stackSize }, (_, index) => {
                const selected = filterSelection?.selectedValueIndexes.includes(
                  values[index].indexInCell
                );
                return (
                  <div
                    key={index}
                    className={`absolute shadow-sm px-3 rounded-md border border-gray-200 ${
                      selected ? 'bg-red-200' : 'bg-white'
                    }`}
                    style={{
                      transform: `translate(${index * 2}px, -${index * 2}px)`,
                    }}
                  >
                    {key}
                  </div>
                );
              })}
            </div>

            <div className="text-xs text-gray-400 text-center mb-1">
              x{values.length}
            </div>
          </div>
        );
      })}
    </div>
  );
};
