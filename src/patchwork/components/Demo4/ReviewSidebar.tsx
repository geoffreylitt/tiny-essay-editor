import { MarkdownDoc } from "@/tee/schema";
import { AutomergeUrl } from "@automerge/automerge-repo";
import * as A from "@automerge/automerge/next";
import CodeMirror from "@uiw/react-codemirror";
import {
  useDocument,
  useHandle,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  ReactNode,
  useCallback,
} from "react";
import {
  ChangeGroup,
  getChangelogItems,
  getGroupedChanges,
  getMarkersForDoc,
} from "../../groupChanges";

import {
  MessageSquare,
  MilestoneIcon,
  SendHorizontalIcon,
  MergeIcon,
  GitBranchIcon,
  GitBranchPlusIcon,
  MoreHorizontal,
  ShareIcon,
} from "lucide-react";
import { Heads } from "@automerge/automerge/next";
import { InlineContactAvatar } from "@/DocExplorer/components/InlineContactAvatar";
import { Branch, DiffWithProvenance, DiscussionComment } from "../../schema";
import { useCurrentAccount } from "@/DocExplorer/account";
import { Button } from "@/components/ui/button";
import { uuid } from "@automerge/automerge";
import { useSlots } from "@/patchwork/utils";
import { TextSelection } from "@/tee/components/MarkdownEditor";

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { completions, slashCommands } from "./slashCommands";
import { EditorView } from "@codemirror/view";
import { createBranch } from "@/patchwork/branches";
import { SelectedBranch } from "@/DocExplorer/components/DocExplorer";
import { populateChangeGroupSummaries } from "@/patchwork/changeGroupSummaries";
import { debounce, isEqual } from "lodash";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type MilestoneSelection = {
  type: "milestone";
  heads: Heads;
};

// the data structure that represents the range of change groups we've selected for showing diffs.
type ChangeGroupSelection = {
  type: "changeGroups";
  /** The older (causally) change group in the selection */
  from: ChangeGroup["id"];

  /** The newer (causally) change group in the selection */
  to: ChangeGroup["id"];
};

type Selection = MilestoneSelection | ChangeGroupSelection;

const useScrollToBottom = () => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [scrollerRef.current]);
  return scrollerRef;
};

export const ReviewSidebar: React.FC<{
  docUrl: AutomergeUrl;
  setDocHeads: (heads: Heads) => void;
  setDiff: (diff: DiffWithProvenance) => void;
  selectedBranch: SelectedBranch;
  setSelectedBranch: (branch: SelectedBranch) => void;
  textSelection: TextSelection;
  onClearTextSelection: () => void;
}> = ({
  docUrl,
  setDocHeads,
  setDiff,
  selectedBranch,
  setSelectedBranch,
  textSelection,
  onClearTextSelection,
}) => {
  const [doc, changeDoc] = useDocument<MarkdownDoc>(docUrl);
  const handle = useHandle<MarkdownDoc>(docUrl);
  const repo = useRepo();
  const account = useCurrentAccount();
  const scrollerRef = useScrollToBottom();

  // TODO: technically this should also update when the "source doc" for this branch updates
  const markers = useMemo(
    () => getMarkersForDoc(handle, repo),
    // Important to have doc as a dependency here even though the linter says not needed
    [doc, handle, repo]
  );

  // The grouping function returns change groups starting from the latest change.
  const changelogItems = useMemo(() => {
    if (!doc) return [];

    return getChangelogItems(doc, {
      algorithm: "ByAuthorOrTime",
      numericParameter: 60,
      markers,
    });
  }, [doc, markers]);

  useAutoPopulateChangeGroupSummaries({ handle, changelogItems });

  return (
    <div className="history h-full w-full flex flex-col gap-2 text-xs text-gray-600">
      <div className="overflow-y-auto flex-1 flex flex-col" ref={scrollerRef}>
        <div className="mt-auto flex flex-col gap-2">
          {changelogItems.map((item) => (
            <div key={item.id} className="pl-2 w-full">
              {(() => {
                switch (item.type) {
                  case "changeGroup":
                    return (
                      <ChangeGroupItem
                        group={item.changeGroup}
                        doc={doc}
                        selected={false}
                      />
                    );
                  case "tag":
                    return <div>Milestone</div>;
                  case "branchCreatedFromThisDoc":
                    return <div>Branch Created</div>;
                  case "discussionThread":
                    return <div>Discussion thread</div>;
                  case "originOfThisBranch":
                    return <div>Origin of this branch</div>;
                  case "otherBranchMergedIntoThisDoc":
                    return (
                      <BranchMergedItem branch={item.branch} selected={false} />
                    );
                  default: {
                    // Ensure we've handled all types
                    const exhaustiveCheck: never = item;
                    return exhaustiveCheck;
                  }
                }
              })()}
            </div>
          ))}
        </div>
      </div>
      <div className="bg-gray-50 z-10">
        <CommentBox />
      </div>
    </div>
  );
};

const CommentBox = () => {
  return <div className="h-16 bg-red-100 p-5">Comment box</div>;
};

const ChangeGroupItem: React.FC<{
  group: ChangeGroup;
  doc: MarkdownDoc;
  selected: boolean;
}> = ({ group, selected, doc }) => {
  return (
    <div className="pl-[7px] pr-1 flex w-full">
      <div className="w-3 h-3 border-b-2 border-l-2 border-gray-300 rounded-bl-full"></div>
      <ChangeGroupDescription
        changeGroup={group}
        selected={selected}
        doc={doc}
      />
      <div className="ml-1">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <MoreHorizontal
              size={18}
              className="mt-1 mr-21 text-gray-500 hover:text-gray-800"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="mr-4">
            <DropdownMenuItem>Context actions go here</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

const ChangeGroupDescription = ({
  changeGroup,
  selected,
  doc,
}: {
  changeGroup: ChangeGroup;
  selected: boolean;
  doc: MarkdownDoc;
}) => {
  let summary;
  if (!doc.changeGroupSummaries || !doc.changeGroupSummaries[changeGroup.id]) {
    // TODO: filter these patches to only include the ones that are relevant to the markdown doc
    summary = `${changeGroup.diff.patches.length} edits`;
  } else {
    summary = doc.changeGroupSummaries[changeGroup.id].title;
  }
  return (
    <div
      className={`w-full group cursor-pointer  p-1 rounded-full font-medium text-xs flex ${
        selected ? "bg-blue-100 bg-opacity-50" : "bg-transparent"
      } `}
    >
      <div className="mr-2 text-gray-500">{summary}</div>

      <div className="ml-auto flex-shrink-0">
        {changeGroup.authorUrls.length > 0 && (
          <div className=" text-gray-600 inline">
            {changeGroup.authorUrls.map((contactUrl) => (
              <div className="inline">
                <InlineContactAvatar
                  key={contactUrl}
                  url={contactUrl}
                  size="sm"
                  showName={false}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const BranchMergedItem: React.FC<{ branch: Branch; selected: boolean }> = ({
  branch,
  selected,
}) => {
  return (
    <ItemView selected={selected} color="purple-600">
      <ItemIcon>
        <GitBranchPlusIcon
          className="h-[10px] w-[10px] text-white"
          strokeWidth={2}
        />
      </ItemIcon>

      <ItemContent>
        <div className="text-sm flex select-none">
          <div>
            <div className="inline font-normal">Branch merged:</div>{" "}
            <div className="inline font-semibold">{branch.name}</div>{" "}
          </div>
          <div className="ml-auto">
            {branch.createdBy && (
              <div className=" text-gray-600 inline">
                <InlineContactAvatar
                  key={branch.createdBy}
                  url={branch.createdBy}
                  size="sm"
                  showName={false}
                />
              </div>
            )}
          </div>
          <div className="ml-1">
            <DropdownMenu>
              <DropdownMenuTrigger>
                <MoreHorizontal
                  size={18}
                  className="mt-1 mr-21 text-gray-500 hover:text-gray-800"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="mr-4">
                <DropdownMenuItem>Context actions go here</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ItemContent>
    </ItemView>
  );
};

const useAutoPopulateChangeGroupSummaries = ({ handle, changelogItems }) => {
  const debouncedPopulate = useCallback(
    debounce(({ groups, handle, force }) => {
      populateChangeGroupSummaries({ groups, handle, force });
    }, 15000),
    []
  );

  useEffect(() => {
    debouncedPopulate({
      groups: changelogItems.flatMap((item) =>
        item.type === "changeGroup" ? item.changeGroup : []
      ),
      handle,
    });

    // Cleanup function to cancel the debounce if the component unmounts
    return () => {
      debouncedPopulate.cancel();
    };
  }, [changelogItems, handle, debouncedPopulate]);
};

const ItemIcon = ({ children }: { children: ReactNode }) => <>{children}</>;
const ItemContent = ({ children }: { children: ReactNode }) => <>{children}</>;

const ItemView = ({
  selected,
  children,
  color = "purple-600",
}: {
  selected: boolean;
  children: ReactNode | ReactNode[];
  color: string;
}) => {
  const [slots] = useSlots(children, { icon: ItemIcon, content: ItemContent });

  return (
    <div className="items-top flex gap-1">
      {slots.icon && (
        <div
          className={`bg-${color} mt-1.5 flex h-[16px] w-[16px] items-center justify-center rounded-full  outline outline-2 outline-gray-100`}
        >
          {slots.icon}
        </div>
      )}

      {!slots.icon && <div className="w-[16px] h-[16px] mt-1.5" />}
      <div
        className={`cursor-pointer flex-1 rounded p-1 shadow ${
          selected ? "bg-blue-100" : "bg-white"
        }`}
      >
        {slots.content}
      </div>
    </div>
  );
};
