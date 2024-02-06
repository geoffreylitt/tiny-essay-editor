import { ListFilter } from "lucide-react";
import { useState } from "react";
import { TextAnnotation } from "../schema";
import { AutomergeUrl } from "@automerge/automerge-repo";
import { ContactAvatar } from "@/DocExplorer/components/ContactAvatar";
import { ReviewStateFilter } from "../utils";
import { filter } from "lodash";

export const HistoryFilter: React.FC<{
  visibleAuthorsForEdits: AutomergeUrl[];
  setVisibleAuthorsForEdits: (authors: AutomergeUrl[]) => void;
  reviewStateFilter: ReviewStateFilter;
  setReviewStateFilter: (filter: ReviewStateFilter) => void;
  authors: AutomergeUrl[];
}> = ({
  visibleAuthorsForEdits,
  setVisibleAuthorsForEdits,
  authors,
  reviewStateFilter,
  setReviewStateFilter,
}) => {
  const [showFilterSettings, setShowFilterSettings] = useState(false);

  return (
    <div
      className={`max-w-[400px] rounded  p-4 text-sm bg-gray-50 border border-gray-200 border-opacity-0 ${
        showFilterSettings && "border-opacity-100"
      }`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <button
            className={`flex-0 grid h-6 w-6 place-items-center rounded-full text-white ${
              showFilterSettings ? "bg-blue-500" : "bg-black"
            }`}
            onClick={() => setShowFilterSettings(!showFilterSettings)}
          >
            <ListFilter className="block" size={16} strokeWidth={2} />
          </button>
        </div>

        {showFilterSettings && (
          <FilterSettings
            authors={authors}
            visibleAuthorsForEdits={visibleAuthorsForEdits}
            setVisibleAuthorsForEdits={setVisibleAuthorsForEdits}
            reviewStateFilter={reviewStateFilter}
            setReviewStateFilter={setReviewStateFilter}
          />
        )}
      </div>
    </div>
  );
};

function TypeIcon({ annotationType }: { annotationType: string }) {
  const symbol = annotationType[0].toUpperCase();

  const colorMap: Record<string, string> = {
    Comments: "bg-yellow-500 border-yellow-600",
    Edits: "bg-green-500 border-green-600",
  };

  const colorClasses =
    colorMap[annotationType] || "bg-gray-500 border-grat-500"; // Default color if type is not found

  return (
    <div>
      <div
        className={`flex h-4 w-4 items-center justify-center rounded border ${colorClasses}`}
      >
        <span className="white font-medium text-white shadow-sm">{symbol}</span>
      </div>
    </div>
  );
}

const FilterSettings: React.FC<{
  authors: AutomergeUrl[];
  visibleAuthorsForEdits: AutomergeUrl[];
  setVisibleAuthorsForEdits: (authors: AutomergeUrl[]) => void;
  reviewStateFilter: ReviewStateFilter;
  setReviewStateFilter: (filter: ReviewStateFilter) => void;
}> = ({
  authors,
  visibleAuthorsForEdits,
  setVisibleAuthorsForEdits,
  reviewStateFilter,
  setReviewStateFilter,
}) => {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div>
          <h2 className="text-[10px] font-bold uppercase text-gray-500">
            Show edits by
          </h2>
          {authors.map((author) => (
            <div key={author} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={visibleAuthorsForEdits.includes(author)}
                onChange={(e) => {
                  const checked = e.target.checked;
                  if (checked) {
                    setVisibleAuthorsForEdits([
                      ...visibleAuthorsForEdits,
                      author,
                    ]);
                  } else {
                    setVisibleAuthorsForEdits(
                      visibleAuthorsForEdits.filter(
                        (visibleAuthor) => visibleAuthor !== author
                      )
                    );
                  }
                }}
              />
              <ContactAvatar url={author} size={"sm"} showName />
            </div>
          ))}
          <h2 className="text-[10px] font-bold uppercase text-gray-500">
            Show reviewed edits
          </h2>
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={reviewStateFilter.showReviewedBySelf}
              onChange={(e) => {
                setReviewStateFilter({
                  ...reviewStateFilter,
                  showReviewedBySelf: e.target.checked,
                });
              }}
            />
            show reviewed by me
          </div>
          <div className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={reviewStateFilter.showReviewedByOthers}
              onChange={(e) => {
                setReviewStateFilter({
                  ...reviewStateFilter,
                  showReviewedByOthers: e.target.checked,
                });
              }}
            />
            show reviewed by others
          </div>
        </div>
      </div>
    </div>
  );
};

function HistoryTrimmer() {
  const [range, setRange] = useState({ start: 0, end: 100 });

  const handleRangeChange = (value, type) => {
    setRange({ ...range, [type]: value });
  };

  return (
    <div className="flex space-x-2">
      <input
        type="range"
        min="0"
        max="100"
        value={range.start}
        onChange={(e) => handleRangeChange(e.target.value, "start")}
        className="w-full"
      />
      <input
        type="range"
        min="0"
        max="100"
        value={range.end}
        onChange={(e) => handleRangeChange(e.target.value, "end")}
        className="w-full"
      />
    </div>
  );
}

function randomHeight() {
  return Math.floor(Math.random() * (8 - 2 + 1)) + 2;
}